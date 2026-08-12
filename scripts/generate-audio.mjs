import { mkdir, writeFile } from 'node:fs/promises';

const rate = 22050;

function clamp(value) {
  return Math.max(-1, Math.min(1, value));
}

function wav(samples) {
  const dataSize = samples.length * 2;
  const out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(dataSize, 40);
  samples.forEach((sample, index) => out.writeInt16LE(Math.round(clamp(sample) * 32767), 44 + index * 2));
  return out;
}

function make(duration, sample) {
  return Array.from({ length: Math.round(duration * rate) }, (_, i) => sample(i / rate, i));
}

function envelope(t, duration, attack = 0.01, release = 0.08) {
  if (t < attack) return t / attack;
  if (t > duration - release) return Math.max(0, (duration - t) / release);
  return 1;
}

function tone(t, frequency) {
  return Math.sin(2 * Math.PI * frequency * t);
}

function noise(index) {
  let seed = (index + 1) * 1103515245 + 12345;
  seed = (seed >>> 0) % 2147483647;
  return seed / 1073741823.5 - 1;
}

function chirp(duration, notes, volume = 0.35) {
  return make(duration, t => {
    const note = notes.find(item => t >= item.at && t < item.at + item.length);
    if (!note) return 0;
    const local = t - note.at;
    return tone(local, note.frequency) * envelope(local, note.length, 0.008, 0.045) * volume;
  });
}

async function save(path, samples) {
  await writeFile(path, wav(samples));
}

await mkdir('public/audio/sfx', { recursive: true });
await mkdir('public/audio/voice', { recursive: true });

// Selection is a dry, high click; playing a hand is a separate low card slap.
await save('public/audio/sfx/card.wav', chirp(0.12, [
  { at: 0, length: 0.045, frequency: 1250 },
  { at: 0.042, length: 0.038, frequency: 1620 },
], 0.18));
await save('public/audio/sfx/play.wav', make(0.34, (t, i) => {
  const e = envelope(t, 0.34, 0.002, 0.17);
  return e * (tone(t, 118) * 0.3 + noise(i) * 0.16 * Math.exp(-t * 8));
}));

// Wet splat and metallic water splash intentionally occupy different frequency ranges.
await save('public/audio/sfx/tomato.wav', make(0.46, (t, i) => {
  const e = envelope(t, 0.46, 0.004, 0.28);
  return e * (tone(t, 72) * 0.3 + noise(i) * 0.28 * Math.exp(-t * 6));
}));
await save('public/audio/sfx/bucket.wav', make(0.78, (t, i) => {
  const e = envelope(t, 0.78, 0.004, 0.3);
  const splash = noise(i) * 0.2 * (0.55 + 0.45 * Math.sin(2 * Math.PI * 19 * t));
  const metal = t < 0.12 ? tone(t, 1080) * 0.2 : 0;
  return e * (splash + metal + tone(t, 420 - t * 180) * 0.08);
}));

// These local prompts keep working on mobile even when browser speech synthesis is unavailable.
await save('public/audio/voice/quick-good-play.wav', chirp(1.1, [
  { at: 0.05, length: 0.18, frequency: 420 },
  { at: 0.29, length: 0.2, frequency: 570 },
  { at: 0.57, length: 0.22, frequency: 680 },
  { at: 0.84, length: 0.17, frequency: 810 },
], 0.2));
await save('public/audio/voice/quick-just-this.wav', chirp(0.72, [
  { at: 0.04, length: 0.2, frequency: 680 },
  { at: 0.31, length: 0.25, frequency: 390 },
], 0.24));
