// PeerJS 网络层：房主 = 权威服务器（游戏逻辑跑在房主浏览器），客人只收发状态
// 使用 PeerJS 公共云做信令，数据通道点对点传输，全程零后端

const PREFIX = 'jiheiwu-room-';
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去掉易混淆字符

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

  create(onReady, onError, tries = 3) {
    this.code = genCode();
    const peer = new Peer(PREFIX + this.code);
    this.peer = peer;
    peer.on('open', () => {
      this.engine.hostPeerId = peer.id; // 供语音直连使用
      onReady(this.code);
    });
    peer.on('error', err => {
      if (err.type === 'unavailable-id' && tries > 1) { // 房间号碰撞，换一个重试
        peer.destroy();
        this.create(onReady, onError, tries - 1);
        return;
      }
      onError(err);
    });
    peer.on('disconnected', () => {
      if (!peer.destroyed) { try { peer.reconnect(); } catch (e) { /* ignore */ } }
    });
    peer.on('connection', conn => this.wire(conn));
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
  }

  join(code, name, token) {
    this.destroy();
    const peer = new Peer();
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code, { reliable: true });
      this.conn = conn;
      conn.on('open', () => conn.send({ t: 'join', name, token, peerId: peer.id }));
      conn.on('data', d => {
        if (!d) return;
        if (d.t === 'welcome') this.h.onWelcome(d);
        else if (d.t === 'state') this.h.onState(d.view);
        else if (d.t === 'err') this.h.onError(d.msg || '发生错误');
      });
      conn.on('close', () => this.h.onClose());
      conn.on('error', () => this.h.onClose());
    });
    peer.on('error', err => {
      if (err.type === 'peer-unavailable') this.h.onError(`找不到房间 ${code}，请检查房间号（房主需保持页面开启）`);
      else this.h.onError('连接错误：' + err.type);
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
