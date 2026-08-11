// PeerJS 网络层：房主 = 权威服务器（游戏逻辑跑在房主浏览器），客人只收发状态
// 使用 PeerJS 公共云做信令，数据通道点对点传输，全程零后端

const PREFIX = 'jiheiwu-room-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符

// 信令握手超时（ms）：公共信令云在移动网络下偶发不响应，超时后重试而非死等
const OPEN_TIMEOUT = 12000;
const RETRY_DELAY = 1000;
const MAX_TRIES = 3;
// 可重试的瞬时错误（信令抖动 / 公共云过载）；peer-unavailable 表示房主不在线，重试无意义
const RETRYABLE = new Set(['network', 'server-error', 'socket-error', 'ssl-unavailable', 'unavailable-id', 'timeout']);

// 把 PeerJS 错误对象转成中文提示
export function describePeerError(err) {
  const type = (err && err.type) || 'unknown';
  const map = {
    'browser-incompatible': '当前浏览器不支持 WebRTC，请用最新版 Safari/Chrome',
    'network': '无法连接信令服务器，请检查网络后重试',
    'server-error': '信令服务器繁忙，请稍后重试',
    'socket-error': '信令连接被中断，请检查网络/代理',
    'ssl-unavailable': 'SSL 不可用，请通过 HTTPS 访问本站',
    'unavailable-id': '房间号冲突，已自动重试',
    'peer-unavailable': '找不到目标房间',
    'timeout': '连接信令服务器超时，请检查网络后重试',
    'disconnected': '连接已断开',
    'unknown': '未知错误',
  };
  return map[type] || type;
}

export function genCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

/* ---------------- 房主端 ---------------- */
export class HostNet {
  constructor(engine, refresh) {
    this.engine = engine;
    this.refresh = refresh; // 每次状态变化后调用：广播视图 + 刷新房主自己的界面
    this.conns = new Map(); // conn -> { pid }
    this.peer = null;
    this.code = null;
  }

  create(onReady, onError, tries = MAX_TRIES) {
    this.code = genCode();
    const peer = new Peer(PREFIX + this.code);
    this.peer = peer;
    let opened = false; // 是否已成功开房（开房后异常不再走重试，保持原行为）
    const timer = setTimeout(() => {
      if (opened) return;
      try { peer.destroy(); } catch (e) { /* ignore */ }
      this._failCreate(onReady, onError, tries, { type: 'timeout' });
    }, OPEN_TIMEOUT);

    peer.on('open', () => {
      opened = true;
      clearTimeout(timer);
      this.engine.hostPeerId = peer.id; // 供语音直连使用
      onReady(this.code);
    });
    peer.on('error', err => {
      if (opened) { onError(err); return; } // 开房后异常：提示但不动房号
      clearTimeout(timer);
      try { peer.destroy(); } catch (e) { /* ignore */ }
      this._failCreate(onReady, onError, tries, err);
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } }
    });
    peer.on('connection', conn => this.wire(conn));
  }

  _failCreate(onReady, onError, tries, err) {
    const type = (err && err.type) || 'unknown';
    if (RETRYABLE.has(type) && tries > 1) {
      setTimeout(() => this.create(onReady, onError, tries - 1), RETRY_DELAY);
      return;
    }
    onError(err);
  }

  wire(conn) {
    this.conns.set(conn, { pid: null });
    conn.on('data', d => this.onData(conn, d));
    conn.on('close', () => this.onClose(conn));
    conn.on('error', () => this.onClose(conn));
  }

  onData(conn, d) {
    const entry = this.conns.get(conn);
    if (!entry) return;
    if (d && d.t === 'join') {
      const res = this.engine.join(d.name, d.token, d.peerId);
      if (res.error) { conn.send({ t: 'err', msg: res.error }); return; }
      entry.pid = res.player.id;
      conn.send({ t: 'welcome', id: res.player.id, token: res.player.id });
    } else if (entry.pid) {
      const err = this.engine.handleMsg(entry.pid, d);
      if (err) conn.send({ t: 'err', msg: err });
    }
    this.refresh();
  }

  onClose(conn) {
    const entry = this.conns.get(conn);
    this.conns.delete(conn);
    if (entry && entry.pid) {
      this.engine.handleDisconnect(entry.pid);
      this.refresh();
    }
  }

  broadcast() {
    for (const [conn, entry] of this.conns) {
      if (entry.pid && conn.open) {
        conn.send({ t: 'state', view: this.engine.viewFor(entry.pid) });
      }
    }
  }

  destroy() {
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
  }
}

/* ---------------- 客人端 ---------------- */
export class GuestNet {
  constructor(handlers) {
    this.h = handlers; // { onWelcome, onState, onError, onClose }
    this.peer = null;
    this.conn = null;
    this.joined = false; // 是否已收到 welcome（入房成功）
  }

  join(code, name, token, tries = MAX_TRIES) {
    this.destroy();
    this.joined = false;
    const peer = new Peer();
    this.peer = peer;
    let resolved = false; // 本轮尝试是否已结束（成功送出 join 或已失败）

    const fail = err => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { peer.destroy(); } catch (e) { /* ignore */ }
      const type = (err && err.type) || 'unknown';
      if (RETRYABLE.has(type) && tries > 1) {
        setTimeout(() => this.join(code, name, token, tries - 1), RETRY_DELAY);
        return;
      }
      if (type === 'peer-unavailable') this.h.onError(`找不到房间 ${code}，请检查房间号（房主需保持页面开启）`);
      else this.h.onError(describePeerError(err));
    };

    const timer = setTimeout(() => fail({ type: 'timeout' }), OPEN_TIMEOUT);

    peer.on('open', () => {
      if (resolved) return;
      const conn = peer.connect(PREFIX + code, { reliable: true });
      this.conn = conn;
      // 握手前掉线：原实现会静默卡住，这里改为瞬时错误自动重试
      const drop = () => {
        if (this.joined) return this.h.onClose(); // 已入房 → 交主控重连
        fail({ type: 'network' });
      };
      conn.on('open', () => {
        if (resolved) return;
        conn.send({ t: 'join', name, token, peerId: peer.id });
      });
      conn.on('data', d => {
        if (!d) return;
        if (d.t === 'welcome') { clearTimeout(timer); this.joined = true; this.h.onWelcome(d); }
        else if (d.t === 'state') this.h.onState(d.view);
        else if (d.t === 'err') this.h.onError(d.msg || '发生错误');
      });
      conn.on('close', drop);
      conn.on('error', drop);
    });
    peer.on('error', err => {
      if (this.joined) return this.h.onClose(); // 入房后信令断开 → 走重连
      fail(err);
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } }
    });
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy() {
    try { this.conn && this.conn.close(); } catch (e) { /* ignore */ }
    try { this.peer && this.peer.destroy(); } catch (e) { /* ignore */ }
    this.conn = null;
    this.peer = null;
  }
}
