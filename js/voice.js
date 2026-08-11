// 实时语音：基于 PeerJS 的 WebRTC 媒体通话，玩家间两两直连（全 mesh）
// 信令复用 PeerJS 公共云，音频数据点对点传输，不经过任何服务器中转
// 主叫判定：双方比较玩家令牌（playerId），字典序小的一方发起呼叫，避免重复/互拨冲突

const audios = new Map(); // peerId -> <audio>

function playAudio(peerId, stream) {
  let a = audios.get(peerId);
  if (!a) {
    a = new Audio();
    a.autoplay = true;
    a.setAttribute('playsinline', '');
    audios.set(peerId, a);
  }
  a.srcObject = stream;
  a.play().catch(() => { /* 自动播放被拦截时，由全局点击兜底恢复 */ });
}

function removeAudio(peerId) {
  const a = audios.get(peerId);
  if (a) { a.srcObject = null; audios.delete(peerId); }
}

// 移动端/浏览器策略：任意点击时尝试恢复被暂停的远端音频
document.addEventListener('click', () => {
  for (const a of audios.values()) {
    if (a.paused && a.srcObject) a.play().catch(() => {});
  }
});

export class VoiceManager {
  constructor() {
    this.peer = null;      // 当前 Peer 实例（房主/客人各自）
    this.stream = null;    // 本地麦克风流；非空即"已开语音"
    this.calls = new Map();// peerId -> MediaConnection
    this.myId = null;      // 我的玩家令牌（用于主叫判定）
    this.roster = [];      // 最新成员名单 [{playerId, peerId}]
  }

  get enabled() { return !!this.stream; }

  attach(peer) {
    this.peer = peer;
    peer.on('call', call => this.onIncoming(call));
  }

  async enable(myId, roster) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.myId = myId;
    this.setRoster(roster);
  }

  disable() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    for (const call of this.calls.values()) { try { call.close(); } catch (e) { /* ignore */ } }
    this.calls.clear();
    for (const peerId of [...audios.keys()]) removeAudio(peerId);
  }

  // 成员变化时增删通话；未开语音时仅记录名单
  setRoster(roster) {
    this.roster = roster || [];
    if (!this.enabled) return;
    const want = new Map();
    for (const m of this.roster) {
      if (m.peerId && m.playerId !== this.myId) want.set(m.peerId, m);
    }
    // 挂断已离开成员的通话
    for (const [peerId, call] of [...this.calls]) {
      if (!want.has(peerId)) {
        try { call.close(); } catch (e) { /* ignore */ }
        this.calls.delete(peerId);
        removeAudio(peerId);
      }
    }
    // 由字典序小的一方主动呼叫
    for (const [peerId, m] of want) {
      if (!this.calls.has(peerId) && this.myId < m.playerId) this.dial(peerId);
    }
  }

  dial(peerId) {
    if (!this.peer || !this.stream || this.peer.destroyed) return;
    const call = this.peer.call(peerId, this.stream);
    if (call) this.wire(call);
  }

  onIncoming(call) {
    if (!this.enabled) { try { call.close(); } catch (e) { /* ignore */ } return; }
    call.answer(this.stream);
    this.wire(call);
  }

  wire(call) {
    const prev = this.calls.get(call.peer);
    if (prev && prev !== call) { try { prev.close(); } catch (e) { /* ignore */ } }
    this.calls.set(call.peer, call);
    call.on('stream', remote => playAudio(call.peer, remote));
    call.on('close', () => {
      if (this.calls.get(call.peer) === call) {
        this.calls.delete(call.peer);
        removeAudio(call.peer);
        this.repair(call.peer);
      }
    });
    call.on('error', () => { /* 网络抖动交给 close/repair 处理 */ });
  }

  // 通话意外断开且我仍是主叫方时，稍后重拨一次
  repair(peerId) {
    if (!this.enabled) return;
    const m = this.roster.find(x => x.peerId === peerId);
    if (!m || this.myId >= m.playerId) return;
    setTimeout(() => {
      if (this.enabled && !this.calls.has(peerId)) this.dial(peerId);
    }, 1500);
  }
}
