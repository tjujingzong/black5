import { comboSpeech } from './speech.js';

const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
const MUSIC_KEY = 'jh5-audio-enabled';

class GameAudio {
  constructor() {
    this.enabled = localStorage.getItem(MUSIC_KEY) !== '0';
    this.context = null;
    this.master = null;
    this.effectGain = null;
    this.music = null;
    this.button = null;
    this.lastState = null;
    this.speechDepth = 0;
  }

  init() {
    this.music = new Audio('/audio/bassa-island-game-loop.mp3');
    this.music.loop = true;
    this.music.preload = 'auto';
    this.music.volume = 0.2;
    this.button = document.getElementById('btn-audio');
    this.updateButton();
    this.button.addEventListener('click', () => this.toggle());
    document.addEventListener('pointerdown', () => this.unlock(), { capture: true });
    document.addEventListener('click', event => {
      if (event.target.closest('#btn-audio')) return;
      if (event.target.closest('[data-card]')) this.play('card');
      else if (event.target.closest('button:not(:disabled)')) this.play('click');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopMusic();
      else if (this.enabled) this.startMusic();
    });
  }

  async unlock() {
    if (!this.enabled || !AudioContextClass) return;
    if (!this.context) {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.effectGain = this.context.createGain();
      this.master.gain.value = 0.9;
      this.effectGain.gain.value = 0.5;
      this.effectGain.connect(this.master);
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.startMusic();
  }

  toggle() {
    this.enabled = !this.enabled;
    localStorage.setItem(MUSIC_KEY, this.enabled ? '1' : '0');
    this.updateButton();
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.9 : 0.0001, this.context.currentTime, 0.015);
    }
    if (this.enabled) this.unlock();
    else {
      this.stopMusic();
      globalThis.speechSynthesis?.cancel();
    }
  }

  updateButton() {
    if (!this.button) return;
    this.button.textContent = this.enabled ? '♫' : '🔇';
    this.button.classList.toggle('active', this.enabled);
    this.button.setAttribute('aria-pressed', String(this.enabled));
    const label = this.enabled ? '关闭音乐和音效' : '开启音乐和音效';
    this.button.setAttribute('aria-label', label);
    this.button.title = label;
  }

  startMusic() {
    if (!this.enabled || !this.music || document.hidden || !this.music.paused) return;
    this.music.play().catch(() => {});
  }

  stopMusic() {
    this.music?.pause();
  }

  voice(frequency, start, duration, volume, type, destination) {
    if (!this.context || !destination) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  play(name) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const tone = (frequency, offset, duration, volume = 0.18, type = 'sine') =>
      this.voice(frequency, now + offset, duration, volume, type, this.effectGain);
    switch (name) {
      case 'click': tone(420, 0, 0.05, 0.1); break;
      case 'card': tone(210, 0, 0.07, 0.14, 'triangle'); tone(160, 0.045, 0.06, 0.08); break;
      case 'join': tone(392, 0, 0.1); tone(523.25, 0.09, 0.16); break;
      case 'ready': tone(440, 0, 0.08); tone(554.37, 0.07, 0.11); break;
      case 'play': tone(196, 0, 0.09, 0.2, 'triangle'); tone(246.94, 0.065, 0.12, 0.14); break;
      case 'turn': tone(523.25, 0, 0.13); tone(659.25, 0.11, 0.18); break;
      case 'start': tone(261.63, 0, 0.16); tone(329.63, 0.1, 0.18); tone(392, 0.2, 0.24); break;
      case 'result': tone(392, 0, 0.2); tone(523.25, 0.12, 0.22); tone(659.25, 0.24, 0.3); break;
      case 'error': tone(180, 0, 0.12, 0.2, 'sawtooth'); tone(145, 0.1, 0.18, 0.14, 'sawtooth'); break;
      case 'tomato': tone(180, 0, 0.08, 0.22, 'triangle'); tone(95, 0.06, 0.16, 0.18, 'sawtooth'); break;
      case 'bucket': tone(520, 0, 0.08, 0.14); tone(360, 0.05, 0.12, 0.15); tone(240, 0.11, 0.18, 0.16); break;
    }
  }

  announce(combo) {
    const text = comboSpeech(combo);
    if (text) this.speak(text);
  }

  speak(text) {
    if (!this.enabled || !text || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.08;
    utterance.pitch = 1;
    utterance.volume = 0.95;
    const voices = speechSynthesis.getVoices();
    utterance.voice = voices.find(voice => voice.lang.toLowerCase() === 'zh-cn')
      || voices.find(voice => voice.lang.toLowerCase().startsWith('zh'))
      || null;
    utterance.onstart = () => {
      this.speechDepth++;
      if (this.music) this.music.volume = 0.07;
    };
    const restore = () => {
      this.speechDepth = Math.max(0, this.speechDepth - 1);
      if (this.music && this.speechDepth === 0) this.music.volume = 0.2;
    };
    utterance.onend = restore;
    utterance.onerror = restore;
    speechSynthesis.speak(utterance);
  }

  observe(view) {
    const next = {
      phase: view.phase,
      round: view.round,
      players: view.players.length,
      ready: view.players.filter(player => player.ready).length,
      turn: view.turnSeat,
      mine: view.mySeat,
      pending: view.pending
        ? `${view.pending.seat}:${view.pending.cards.map(card => card.id).join(',')}`
        : '',
      combo: view.pending?.combo || null,
      quickId: (view.chat || []).length ? view.chat[view.chat.length - 1].id : 0,
      quick: (view.chat || []).length ? view.chat[view.chat.length - 1] : null,
      interactionId: view.lastInteraction?.id || 0,
      interaction: view.lastInteraction || null,
    };
    const previous = this.lastState;
    this.lastState = next;
    if (!previous) return;
    const played = next.pending && next.pending !== previous.pending;
    if (played) {
      this.play('play');
      this.announce(next.combo);
    }
    if (previous.phase !== 'roundEnd' && next.phase === 'roundEnd') this.play('result');
    else if (previous.phase !== 'playing' && next.phase === 'playing') this.play('start');
    else if (!played && previous.turn !== next.turn && next.turn === next.mine) this.play('turn');
    else if (next.players > previous.players) this.play('join');
    else if (next.ready > previous.ready) this.play('ready');
    if (next.quickId > previous.quickId && next.quick?.quick) this.speak(next.quick.text);
    if (next.interactionId > previous.interactionId) this.play(next.interaction.item);
  }
}

export const gameAudio = new GameAudio();
