import { Game } from '../public/js/engine.js';

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 64 * 1024;
const BOT_DELAY_MS = 650;

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function generateCode() {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const byte of bytes) code += CODE_CHARS[byte % CODE_CHARS.length];
  return code;
}

function validCode(code) {
  return new RegExp(`^[${CODE_CHARS}]{${CODE_LENGTH}}$`).test(code);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'black5' });
    }

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: '请求内容无效' }, 400);
      }
      const name = String(body && body.name || '').trim().slice(0, 8);
      if (!name) return json({ error: '请先输入昵称' }, 400);

      for (let attempt = 0; attempt < 8; attempt++) {
        const code = generateCode();
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        const response = await room.fetch('https://room.internal/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (response.status === 409) continue;
        if (!response.ok) return json({ error: '创建房间失败' }, 502);
        const created = await response.json();
        return json({ code, token: created.token }, 201);
      }
      return json({ error: '房间号生成失败，请重试' }, 503);
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{5})\/ws$/);
    if (match && request.method === 'GET') {
      const code = match[1];
      if (!validCode(code)) return json({ error: '房间号无效' }, 400);
      const room = env.ROOMS.get(env.ROOMS.idFromName(code));
      return room.fetch(request);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: '接口不存在' }, 404);
    return env.ASSETS.fetch(request);
  },
};

function restoreGame(saved) {
  if (!saved) return null;
  const game = new Game();
  Object.assign(game, saved);
  return game.normalize();
}

export class Room {
  constructor(state) {
    this.state = state;
    this.game = null;
    this.botRunning = false;
    this.voiceChunkAt = new Map();
    state.blockConcurrencyWhile(async () => {
      const [saved, expiresAt] = await Promise.all([
        state.storage.get('game'),
        state.storage.get('expiresAt'),
      ]);
      this.game = restoreGame(saved);
      this.expiresAt = expiresAt || Date.now() + ROOM_TTL_MS;
    });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/create' && request.method === 'POST') {
      return this.create(request);
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ error: '需要 WebSocket 连接' }, 426);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null });
    return new Response(null, { status: 101, webSocket: client });
  }

  async create(request) {
    if (this.game) return json({ error: '房间号已存在' }, 409);
    const { name } = await request.json();
    this.game = new Game();
    const result = this.game.join(name);
    result.player.connected = false;
    await this.persist();
    return json({ token: result.player.id }, 201);
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_LENGTH) {
      this.reject(ws, '消息格式无效', 4002);
      return;
    }

    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      this.reject(ws, '消息格式无效', 4002);
      return;
    }

    const attachment = ws.deserializeAttachment() || {};
    if (!attachment.playerId) {
      await this.joinSocket(ws, data);
      return;
    }

    if (!this.game) {
      this.reject(ws, '房间已失效', 4004);
      return;
    }
    if (data && data.t === 'voiceChunk') {
      this.broadcastVoiceChunk(attachment.playerId, data);
      return;
    }
    // Compatibility with a briefly cached Worker version: old clients may send
    // the first voice packet before the new asset is refreshed.
    if (data && data.t === 'voiceSignal') return;

    if (this.game.timeoutTurn()) {
      await this.persist();
      this.broadcast();
      await this.runBots();
    }

    const error = this.game.handleMsg(attachment.playerId, data);
    if (error) {
      this.send(ws, { t: 'err', msg: error });
      return;
    }
    await this.persist();
    this.broadcast();
    await this.runBots();
  }

  async joinSocket(ws, data) {
    if (!data || data.t !== 'join') {
      this.reject(ws, '请先加入房间', 4001);
      return;
    }
    if (!this.game) {
      this.reject(ws, '找不到房间，请检查房间号', 4004);
      return;
    }

    const result = this.game.join(data.name, data.token || null);
    if (result.error) {
      this.reject(ws, result.error, 4003);
      return;
    }

    const playerId = result.player.id;
    ws.serializeAttachment({ playerId });
    if (this.game.phase === 'playing' && !Number.isFinite(this.game.turnDeadline)) {
      this.game.resetTurnTimer();
    }
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      const otherAttachment = other.deserializeAttachment() || {};
      if (otherAttachment.playerId === playerId) other.close(4000, 'replaced');
    }

    this.send(ws, { t: 'welcome', id: playerId, token: playerId });
    await this.persist();
    this.broadcast();
    await this.runBots();
  }

  async webSocketClose(ws) {
    await this.disconnectSocket(ws);
  }

  async webSocketError(ws) {
    await this.disconnectSocket(ws);
  }

  async disconnectSocket(ws) {
    const { playerId } = ws.deserializeAttachment() || {};
    if (!playerId || !this.game) return;
    const hasReplacement = this.state.getWebSockets().some(other => {
      if (other === ws || other.readyState !== 1) return false;
      return (other.deserializeAttachment() || {}).playerId === playerId;
    });
    if (hasReplacement) return;
    this.game.handleDisconnect(playerId);
    const hasConnections = this.state.getWebSockets().some(other => other !== ws && other.readyState === 1);
    if (!hasConnections && this.game.phase === 'playing') this.game.pauseTurnTimer();
    await this.persist();
    this.broadcast();
  }

  send(ws, data) {
    if (ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(data));
    } catch (e) {
      // A close/error event will perform disconnect cleanup.
    }
  }

  broadcastVoiceChunk(fromId, data) {
    const from = this.game.players.find(player => player.id === fromId);
    const mime = String(data.mime || '').slice(0, 64);
    const payload = String(data.data || '');
    const now = Date.now();
    const lastChunkAt = this.voiceChunkAt.get(fromId) || 0;
    if (!from || from.isBot || !from.voice || !/^audio\/(webm|mp4|ogg)/.test(mime)
      || !payload || payload.length > 56 * 1024 || !/^[A-Za-z0-9+/]+=*$/.test(payload)
      || now - lastChunkAt < 400) return;
    this.voiceChunkAt.set(fromId, now);
    for (const ws of this.state.getWebSockets()) {
      const { playerId } = ws.deserializeAttachment() || {};
      if (playerId && playerId !== fromId) {
        this.send(ws, { t: 'voiceChunk', from: from.publicId, mime, data: payload, seq: Number(data.seq) || 0 });
      }
    }
  }

  async runBots() {
    if (this.botRunning || !this.game) return;
    this.botRunning = true;
    try {
      while (this.game.phase === 'playing') {
        const player = this.game.players[this.game.turn];
        if (!player || !player.isBot) break;
        await new Promise(resolve => setTimeout(resolve, BOT_DELAY_MS));
        if (!this.game || this.game.phase !== 'playing' || !this.game.players[this.game.turn]?.isBot) break;
        if (!this.game.actBot()) break;
        await this.persist();
        this.broadcast();
      }
    } finally {
      this.botRunning = false;
    }
  }

  reject(ws, message, code) {
    this.send(ws, { t: 'err', msg: message });
    try {
      ws.close(code, 'rejected');
    } catch (e) {
      // Ignore an already closed socket.
    }
  }

  broadcast() {
    if (!this.game) return;
    for (const ws of this.state.getWebSockets()) {
      const { playerId } = ws.deserializeAttachment() || {};
      if (playerId) this.send(ws, { t: 'state', view: this.game.viewFor(playerId) });
    }
  }

  async persist() {
    this.expiresAt = Date.now() + ROOM_TTL_MS;
    await Promise.all([
      this.state.storage.put('game', this.game),
      this.state.storage.put('expiresAt', this.expiresAt),
      this.scheduleAlarm(),
    ]);
  }

  scheduleAlarm() {
    const hasConnections = this.state.getWebSockets().some(ws => ws.readyState === 1);
    const turnDeadline = hasConnections && this.game?.phase === 'playing'
      ? this.game.turnDeadline
      : null;
    const next = Number.isFinite(turnDeadline)
      ? Math.min(this.expiresAt, turnDeadline)
      : this.expiresAt;
    return this.state.storage.setAlarm(Math.max(Date.now() + 50, next));
  }

  async alarm() {
    const hasConnections = this.state.getWebSockets().some(ws => ws.readyState === 1);
    if (hasConnections) {
      if (this.game?.timeoutTurn()) {
        await this.persist();
        this.broadcast();
        await this.runBots();
        return;
      }
      this.expiresAt = Date.now() + ROOM_TTL_MS;
      await Promise.all([
        this.state.storage.put('expiresAt', this.expiresAt),
        this.scheduleAlarm(),
      ]);
      return;
    }
    if (Date.now() < this.expiresAt) {
      await this.scheduleAlarm();
      return;
    }
    this.game = null;
    await this.state.storage.deleteAll();
  }
}
