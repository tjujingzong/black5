import { comboSpeech, speechLanguage } from './speech.js';

const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
const LEGACY_AUDIO_KEY = 'jh5-audio-enabled';
const MUSIC_KEY = 'jh5-music-enabled';
const EFFECTS_KEY = 'jh5-effects-enabled';

class GameAudio {
  constructor() {
    const legacyEnabled = localStorage.getItem(LEGACY_AUDIO_KEY) !== '0';
    this.musicEnabled = localStorage.getItem(MUSIC_KEY) == null
      ? legacyEnabled
      : localStorage.getItem(MUSIC_KEY) !== '0';
    this.effectsEnabled = localStorage.getItem(EFFECTS_KEY) == null
      ? legacyEnabled
      : localStorage.getItem(EFFECTS_KEY) !== '0';
    this.context = null;
    this.master = null;
    this.effectGain = null;
    this.music = null;
    this.musicButton = null;
    this.effectsButton = null;
    this.lastState = null;
    this.speechDepth = 0;
  }

  init() {
    this.music = new Audio('/audio/bassa-island-game-loop.mp3');
    this.music.loop = true;
    this.music.preload = 'auto';
    this.music.volume = 0.2;
    this.musicButton = document.getElementById('btn-music');
    this.effectsButton = document.getElementById('btn-effects');
    this.updateButtons();
    this.musicButton.addEventListener('click', () => this.toggleMusic());
    this.effectsButton.addEventListener('click', () => this.toggleEffects());
    document.addEventListener('pointerdown', () => this.unlock(), { capture: true });
    document.addEventListener('click', event => {
      if (event.target.closest('#btn-music, #btn-effects')) return;
      if (event.target.closest('[data-card]')) this.play('card');
      else if (event.target.closest('button:not(:disabled)')) this.play('click');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopMusic();
      else if (this.musicEnabled) this.startMusic();
    });
  }

  async unlock() {
    if (this.effectsEnabled && AudioContextClass && !this.context) {
      this.context = new AudioContextClass();
      this.master = this.context.createGain();
      this.effectGain = this.context.createGain();
      this.master.gain.value = 0.9;
      this.effectGain.gain.value = 0.5;
      this.effectGain.connect(this.master);
      this.master.connect(this.context.destination);
    }
    if (this.effectsEnabled && this.context?.state === 'suspended') await this.context.resume();
    if (this.musicEnabled) this.startMusic();
  }

  toggleMusic() {
    this.musicEnabled = !this.musicEnabled;
    localStorage.setItem(MUSIC_KEY, this.musicEnabled ? '1' : '0');
    this.updateButtons();
    if (this.musicEnabled) this.unlock();
    else this.stopMusic();
  }

  toggleEffects() {
    this.effectsEnabled = !this.effectsEnabled;
    localStorage.setItem(EFFECTS_KEY, this.effectsEnabled ? '1' : '0');
    this.updateButtons();
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.effectsEnabled ? 0.9 : 0.0001, this.context.currentTime, 0.015);
    }
    if (this.effectsEnabled) this.unlock();
    else globalThis.speechSynthesis?.cancel();
  }

  updateButtons() {
    if (this.musicButton) {
      this.musicButton.textContent = this.musicEnabled ? '♫' : '♪';
      this.musicButton.classList.toggle('active', this.musicEnabled);
      this.musicButton.setAttribute('aria-pressed', String(this.musicEnabled));
      const label = this.musicEnabled ? '关闭背景音乐' : '开启背景音乐';
      this.musicButton.setAttribute('aria-label', label);
      this.musicButton.title = label;
    }
    if (this.effectsButton) {
      this.effectsButton.textContent = this.effectsEnabled ? '🔊' : '🔇';
      this.effectsButton.classList.toggle('active', this.effectsEnabled);
      this.effectsButton.setAttribute('aria-pressed', String(this.effectsEnabled));
      const label = this.effectsEnabled ? '关闭牌局音效' : '开启牌局音效';
      this.effectsButton.setAttribute('aria-label', label);
      this.effectsButton.title = label;
    }
  }

  startMusic() {
    if (!this.musicEnabled || !this.music || document.hidden || !this.music.paused) return;
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

  noise(start, duration, volume, filterType, frequency) {
    if (!this.context || !this.effectGain) return;
    const frames = Math.ceil(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, frames, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.effectGain);
    source.start(start);
    source.stop(start + duration);
  }

  play(name) {
    if (!this.effectsEnabled || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    const tone = (frequency, offset, duration, volume = 0.18, type = 'sine') =>
      this.voice(frequency, now + offset, duration, volume, type, this.effectGain);
    switch (name) {
      case 'click': tone(420, 0, 0.05, 0.1); break;
      case 'card': tone(210, 0, 0.07, 0.14, 'triangle'); tone(160, 0.045, 0.06, 0.08); break;
      case 'join': tone(392, 0, 0.1); tone(523.25, 0.09, 0.16); break;
      case 'ready': tone(440, 0, 0.08); tone(554.37, 0.07, 0.11); break;
      case 'play': tone(196, 0, 0.09, 0.2, 'triangle'); tone(246.94, 0.065, 0.12, 0.14); break;
      case 'pass': tone(260, 0, 0.06, 0.08); tone(190, 0.05, 0.1, 0.08, 'triangle'); break;
      case 'turn': tone(523.25, 0, 0.13); tone(659.25, 0.11, 0.18); break;
      case 'start': tone(261.63, 0, 0.16); tone(329.63, 0.1, 0.18); tone(392, 0.2, 0.24); break;
      case 'result': tone(392, 0, 0.2); tone(523.25, 0.12, 0.22); tone(659.25, 0.24, 0.3); break;
      case 'error': tone(180, 0, 0.12, 0.2, 'sawtooth'); tone(145, 0.1, 0.18, 0.14, 'sawtooth'); break;
      case 'tomato':
        this.noise(now, 0.24, 0.34, 'lowpass', 480);
        tone(150, 0.02, 0.13, 0.2, 'triangle');
        break;
      case 'bucket':
        this.noise(now, 0.52, 0.24, 'bandpass', 1100);
        tone(620, 0, 0.12, 0.1); tone(360, 0.09, 0.18, 0.12); tone(190, 0.2, 0.25, 0.13);
        break;
    }
  }

  announce(combo) {
    const text = comboSpeech(combo);
    if (text) this.speak(text);
  }

  speak(text) {
    if (!this.effectsEnabled || !text || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLanguage(text);
    utterance.rate = 1.08;
    utterance.pitch = 1;
    utterance.volume = 0.95;
    const voices = speechSynthesis.getVoices();
    const language = utterance.lang.toLowerCase();
    utterance.voice = voices.find(voice => voice.lang.toLowerCase() === language)
      || voices.find(voice => voice.lang.toLowerCase().startsWith(language.slice(0, 2)))
      || null;
    utterance.onstart = () => {
      this.speechDepth++;
      if (this.musicEnabled && this.music) this.music.volume = 0.07;
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
      audioId: view.audioEvent?.id || 0,
      audioEvent: view.audioEvent || null,
    };
    const previous = this.lastState;
    this.lastState = next;
    if (!previous) return;
    const action = next.audioId > previous.audioId ? next.audioEvent : null;
    if (action?.type === 'play') {
      this.play('play');
      this.announce(action.combo);
    } else if (action?.type === 'pass') {
      this.play('pass');
      this.speak(action.text);
    }
    if (previous.phase !== 'roundEnd' && next.phase === 'roundEnd') this.play('result');
    else if (previous.phase !== 'playing' && next.phase === 'playing') this.play('start');
    else if (!action && previous.turn !== next.turn && next.turn === next.mine) this.play('turn');
    else if (next.players > previous.players) this.play('join');
    else if (next.ready > previous.ready) this.play('ready');
    if (next.quickId > previous.quickId && next.quick?.quick) this.speak(next.quick.text);
    if (next.interactionId > previous.interactionId) this.play(next.interaction.item);
  }
}

export const gameAudio = new GameAudio();
