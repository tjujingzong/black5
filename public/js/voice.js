// Reliable room voice: short encoded audio slices are broadcast by the room WebSocket.
// This works across mobile carriers and restrictive NATs without requiring a TURN server.
const SLICE_MS = 800;
const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/webm',
];

export class VoiceChat {
  constructor({ send, onState, onError }) {
    this.send = send;
    this.onState = onState;
    this.onError = onError;
    this.enabled = false;
    this.connected = false;
    this.stream = null;
    this.recorder = null;
    this.sliceTimer = null;
    this.sequence = 0;
    this.playQueue = [];
    this.playerPrimed = false;
    this.player = new Audio();
    this.player.autoplay = true;
    this.player.playsInline = true;
    this.player.addEventListener('ended', () => this.playNext());
    this.player.addEventListener('error', () => this.playNext());
    const unlock = () => this.unlockPlayer();
    document.addEventListener('pointerdown', unlock, { capture: true });
    document.addEventListener('touchstart', unlock, { capture: true, passive: true });
  }

  async toggle() {
    try {
      if (this.enabled) this.disable();
      else await this.enable();
    } catch (error) {
      this.stopRecorder();
      for (const track of this.stream?.getTracks() || []) track.stop();
      this.stream = null;
      this.enabled = false;
      this.onState({ enabled: false, busy: false });
      this.onError(`语音启动失败（${error?.name || 'UnknownError'}），请确认网页已允许麦克风权限`);
    }
  }

  async enable() {
    if (!globalThis.isSecureContext) {
      this.onError('语音需要 HTTPS 页面，请使用 Cloudflare 的 https 地址');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.onError('当前浏览器未提供麦克风权限接口，请检查系统权限和浏览器设置');
      return;
    }
    if (!globalThis.MediaRecorder) {
      this.onError('当前浏览器不支持录音编码，请更新浏览器后重试');
      return;
    }
    try {
      this.onState({ enabled: false, busy: true });
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        });
      } catch (error) {
        // Some iOS builds reject advanced constraints; retry with the minimum request.
        if (error?.name === 'OverconstrainedError' || error?.name === 'NotReadableError' || error?.name === 'UnknownError') {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } else throw error;
      }
      this.enabled = true;
      this.onState({ enabled: true, busy: false });
      if (this.connected) {
        this.send({ t: 'voiceStatus', enabled: true });
        this.recordNextSlice();
      }
    } catch (error) {
      this.onState({ enabled: false, busy: false });
      const labels = {
        NotAllowedError: '未获得麦克风权限，请在浏览器设置中允许麦克风',
        NotFoundError: '没有找到可用的麦克风设备',
        NotReadableError: '麦克风正被其他应用占用',
        SecurityError: '浏览器安全策略阻止了麦克风',
        OverconstrainedError: '当前麦克风不支持游戏所需参数',
        UnknownError: '浏览器返回未知错误，请关闭其他占用麦克风的应用后重试',
      };
      this.onError(labels[error?.name] || `无法开启麦克风（${error?.name || 'UnknownError'}）`);
    }
  }

  disable(notify = true) {
    if (notify && this.enabled && this.connected) this.send({ t: 'voiceStatus', enabled: false });
    this.enabled = false;
    this.stopRecorder();
    for (const track of this.stream?.getTracks() || []) track.stop();
    this.stream = null;
    this.onState({ enabled: false, busy: false });
  }

  onConnected() {
    this.connected = true;
    if (!this.enabled) return;
    this.send({ t: 'voiceStatus', enabled: true });
    this.recordNextSlice();
  }

  onDisconnected() {
    this.connected = false;
    this.stopRecorder();
  }

  update() {}

  unlockPlayer() {
    if (this.playerPrimed) {
      this.playNext();
      return;
    }
    this.playerPrimed = true;
    this.player.src = '/audio/sfx/silence.wav';
    this.player.volume = 0.0001;
    Promise.resolve(this.player.play()).then(() => {
      this.player.pause();
      this.player.currentTime = 0;
      this.player.volume = 1;
      this.playNext();
    }).catch(() => {
      this.playerPrimed = false;
    });
  }

  recordNextSlice() {
    if (!this.enabled || !this.connected || !this.stream || this.recorder) return;
    const mimeType = MIME_TYPES.find(type => {
      try { return MediaRecorder.isTypeSupported ? MediaRecorder.isTypeSupported(type) : false; }
      catch (error) { return false; }
    }) || '';
    try {
      const recorder = new MediaRecorder(this.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32000,
      });
      const chunks = [];
      this.recorder = recorder;
      recorder.addEventListener('dataavailable', event => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener('error', event => {
        this.onError(`录音器发生错误（${event.error?.name || 'UnknownError'}），请重新点击语音`);
        this.stopRecorder();
      });
      recorder.addEventListener('stop', async () => {
        if (this.recorder === recorder) this.recorder = null;
        if (this.enabled && this.connected && chunks.length) {
          const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
          try {
            const data = await blobToBase64(blob);
            if (data.length <= 56 * 1024) {
              this.send({ t: 'voiceChunk', mime: blob.type, data, seq: ++this.sequence });
            }
          } catch (error) {
            // A following slice can recover without interrupting the microphone.
          }
        }
        if (this.enabled && this.connected) this.recordNextSlice();
      });
      recorder.start(250);
      this.sliceTimer = setTimeout(() => {
        this.sliceTimer = null;
        if (recorder.state === 'recording') recorder.stop();
      }, SLICE_MS);
    } catch (error) {
      this.recorder = null;
      this.onError(`语音编码启动失败（${error?.name || 'UnknownError'}），当前浏览器可能不支持网页录音`);
      this.disable();
    }
  }

  stopRecorder() {
    clearTimeout(this.sliceTimer);
    this.sliceTimer = null;
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder?.state === 'recording') recorder.stop();
  }

  handleChunk(message) {
    if (!message?.data || !/^audio\/(webm|mp4|ogg)/.test(message.mime || '')) return;
    try {
      const binary = atob(message.data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: message.mime }));
      this.playQueue.push(url);
      if (this.playQueue.length > 5) URL.revokeObjectURL(this.playQueue.shift());
      this.playNext();
    } catch (error) {
      // Ignore a malformed or unsupported voice slice.
    }
  }

  playNext() {
    if (!this.playerPrimed) return;
    if (!this.player.paused && !this.player.ended) return;
    const previous = this.player.src;
    const next = this.playQueue.shift();
    if (!next) return;
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
    this.player.src = next;
    this.player.play().catch(() => {
      this.playQueue.unshift(next);
    });
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
