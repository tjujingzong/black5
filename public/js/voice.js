// 房间语音：房间服务负责信令，媒体由浏览器点对点传输。
const PeerConnection = globalThis.RTCPeerConnection;

export class VoiceChat {
  constructor({ send, onState, onError }) {
    this.send = send;
    this.onState = onState;
    this.onError = onError;
    this.enabled = false;
    this.stream = null;
    this.myId = null;
    this.players = [];
    this.peers = new Map();
  }

  async toggle() {
    if (this.enabled) this.disable();
    else await this.enable();
  }

  async enable() {
    if (!PeerConnection || !navigator.mediaDevices?.getUserMedia) {
      this.onError('当前浏览器不支持实时语音');
      return;
    }
    try {
      this.onState({ enabled: false, busy: true });
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.enabled = true;
      this.onState({ enabled: true, busy: false });
      this.send({ t: 'voiceStatus', enabled: true });
      await this.syncPeers();
    } catch (error) {
      this.onState({ enabled: false, busy: false });
      this.onError(error?.name === 'NotAllowedError' ? '未获得麦克风权限' : '无法开启麦克风');
    }
  }

  disable(notify = true) {
    if (notify && this.enabled) this.send({ t: 'voiceStatus', enabled: false });
    this.enabled = false;
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.onState({ enabled: false, busy: false });
  }

  onConnected() {
    if (this.enabled) this.send({ t: 'voiceStatus', enabled: true });
  }

  onDisconnected() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  async update(view) {
    this.myId = view.myId;
    this.players = view.players || [];
    const connected = new Set(this.players
      .filter(player => player.id !== this.myId && player.connected && !player.isBot)
      .map(player => player.id));
    for (const id of [...this.peers.keys()]) if (!connected.has(id)) this.closePeer(id);
    await this.syncPeers();
  }

  async syncPeers() {
    if (!this.enabled || !this.stream || !this.myId) return;
    const active = new Set(this.players
      .filter(player => player.id !== this.myId && player.connected && !player.isBot)
      .map(player => player.id));
    // Each person who enables their microphone publishes one stream to every human player.
    // Listeners do not need to enable their own microphone to receive it.
    for (const id of active) {
      const player = this.players.find(item => item.id === id);
      // One deterministic side starts when both users are speaking. If the other
      // person is only listening, the broadcaster starts regardless of ID order.
      const record = this.peers.get(id);
      const needsRenegotiation = this.stream && !record?.localTracksAdded && record?.pc.remoteDescription;
      const initiate = needsRenegotiation || !player?.voice || this.myId.localeCompare(id) < 0;
      await this.ensurePeer(id, initiate);
    }
  }

  async ensurePeer(id, initiate = false) {
    if (!id) return null;
    let record = this.peers.get(id);
    if (!record) {
      const pc = new PeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
      record = { pc, audio: null, pendingIce: [], offered: false, localTracksAdded: false, needsOffer: false };
      this.peers.set(id, record);
      pc.addEventListener('icecandidate', event => {
        if (event.candidate) this.signal(id, 'ice', event.candidate.toJSON());
      });
      pc.addEventListener('track', event => {
        if (!record.audio) {
          record.audio = new Audio();
          record.audio.autoplay = true;
          record.audio.playsInline = true;
        }
        record.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        record.audio.play().catch(() => {});
      });
      pc.addEventListener('connectionstatechange', () => {
        if (['failed', 'closed'].includes(pc.connectionState)) this.closePeer(id);
      });
    }
    if (this.stream && !record.localTracksAdded) {
      for (const track of this.stream.getTracks()) record.pc.addTrack(track, this.stream);
      record.localTracksAdded = true;
      record.needsOffer = true;
    }
    if (initiate && record.needsOffer && record.pc.signalingState === 'stable') {
      record.offered = true;
      record.needsOffer = false;
      const offer = await record.pc.createOffer();
      await record.pc.setLocalDescription(offer);
      this.signal(id, 'offer', record.pc.localDescription.toJSON());
    }
    return record;
  }

  async handleSignal(message) {
    if (!message?.from || !message.kind || !message.data) return;
    try {
      const record = await this.ensurePeer(message.from, false);
      if (!record) return;
      if (message.kind === 'offer') {
        if (record.pc.signalingState !== 'stable') {
          // Simultaneous microphone activation can create two offers. The lower
          // public ID keeps its outgoing offer; the other side rolls back.
          if (this.myId && this.myId.localeCompare(message.from) < 0) return;
          await record.pc.setLocalDescription({ type: 'rollback' });
        }
        await record.pc.setRemoteDescription(message.data);
        const answer = await record.pc.createAnswer();
        await record.pc.setLocalDescription(answer);
        record.needsOffer = false;
        this.signal(message.from, 'answer', record.pc.localDescription.toJSON());
        await this.flushIce(record);
      } else if (message.kind === 'answer') {
        if (!record.offered) return;
        await record.pc.setRemoteDescription(message.data);
        await this.flushIce(record);
      } else if (message.kind === 'ice') {
        if (record.pc.remoteDescription) await record.pc.addIceCandidate(message.data);
        else record.pendingIce.push(message.data);
      }
    } catch (error) {
      this.closePeer(message.from);
      this.onError('语音连接建立失败，请重新打开麦克风');
    }
  }

  async flushIce(record) {
    for (const candidate of record.pendingIce.splice(0)) await record.pc.addIceCandidate(candidate);
  }

  signal(to, kind, data) {
    this.send({ t: 'voiceSignal', to, kind, data });
  }

  closePeer(id) {
    const record = this.peers.get(id);
    if (!record) return;
    record.audio?.pause();
    if (record.audio) record.audio.srcObject = null;
    record.pc.close();
    this.peers.delete(id);
  }
}
