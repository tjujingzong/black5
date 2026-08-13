// 网络层：所有玩家通过同源实时连接接入房间服务。

const CONNECT_TIMEOUT = 15000;

async function responseError(response, fallback) {
  try {
    const data = await response.json();
    return data.error || fallback;
  } catch (e) {
    return fallback;
  }
}

export async function createRoom(name) {
  let response;
  try {
    response = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } catch (e) {
    throw new Error('无法连接游戏服务器，请检查网络');
  }
  if (!response.ok) throw new Error(await responseError(response, '创建房间失败'));
  return response.json();
}

export class RoomNet {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.manualClose = false;
    this.joined = false;
    this.rejected = false;
    this.timer = null;
  }

  connect(code, name, token) {
    this.destroy();
    this.manualClose = false;
    this.joined = false;
    this.rejected = false;

    const url = new URL(`/api/rooms/${code}/ws`, location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url);
    this.ws = ws;
    this.timer = setTimeout(() => {
      if (this.joined || this.ws !== ws) return;
      this.h.onError('连接服务器超时');
      try { ws.close(); } catch (e) { /* ignore */ }
    }, CONNECT_TIMEOUT);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ t: 'join', name, token }));
    });
    ws.addEventListener('message', event => {
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      if (data.t === 'welcome') {
        this.joined = true;
        clearTimeout(this.timer);
        this.h.onWelcome(data);
      } else if (data.t === 'state') {
        this.h.onState(data.view);
      } else if (data.t === 'voiceChunk') {
        this.h.onVoiceChunk(data);
      } else if (data.t === 'err') {
        if (!this.joined) this.rejected = true;
        this.h.onError(data.msg || '服务器拒绝了请求');
      }
    });
    ws.addEventListener('close', () => {
      clearTimeout(this.timer);
      if (this.ws !== ws || this.manualClose) return;
      this.h.onClose({ joined: this.joined, rejected: this.rejected });
    });
    ws.addEventListener('error', () => {
      if (!this.joined && !this.rejected) this.h.onError('无法建立实时连接');
    });
  }

  send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.joined) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  destroy() {
    this.manualClose = true;
    clearTimeout(this.timer);
    try { this.ws && this.ws.close(); } catch (e) { /* ignore */ }
    this.ws = null;
  }
}
