import { rankChar } from './cards.js';

export function comboSpeech(combo) {
  if (!combo) return '';
  const rank = rankChar(combo.rank);
  return {
    single: rank,
    pair: `对${rank}`,
    triple: `三个${rank}，炸弹`,
    quad: `四个${rank}，轰牌`,
    straight: '顺子',
    pairs: '姊妹对',
  }[combo.kind] || '';
}

export function speechLanguage(text) {
  return String(text || '').trim().toLowerCase() === 'pass' ? 'en-US' : 'zh-CN';
}
