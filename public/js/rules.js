// 牌型判定 / 比大小 / 出牌提示
// 牌型：single 单张 | pair 对子 | triple 三张(炸弹) | quad 四张(轰牌)
//       straight 顺子(3张以上，不含2) | pairs 连对(2连对以上，不含2)

export function classify(cards) {
  const n = cards.length;
  if (!n) return null;
  const ranks = cards.map(c => c.rank).sort((a, b) => a - b);
  const uniq = [...new Set(ranks)];

  if (n === 1) return { kind: 'single', rank: ranks[0], len: 1 };

  if (uniq.length === 1) {
    if (n === 2) return { kind: 'pair', rank: ranks[0], len: 2 };
    if (n === 3) return { kind: 'triple', rank: ranks[0], len: 3 }; // 炸弹
    if (n === 4) return { kind: 'quad', rank: ranks[0], len: 4 };   // 轰牌
    return null;
  }

  // 顺子：点数连续、不重复、最长到 A（2 不参与）
  if (n >= 3 && uniq.length === n && uniq[n - 1] <= 14 && uniq[n - 1] - uniq[0] === n - 1) {
    return { kind: 'straight', rank: uniq[n - 1], len: n };
  }

  // 连对：每点恰好两张、点数连续、最长到 A
  if (n >= 4 && n % 2 === 0) {
    const cnt = {};
    ranks.forEach(r => cnt[r] = (cnt[r] || 0) + 1);
    const us = Object.keys(cnt).map(Number).sort((a, b) => a - b);
    if (Object.values(cnt).every(v => v === 2) && us[us.length - 1] <= 14 && us[us.length - 1] - us[0] === us.length - 1) {
      return { kind: 'pairs', rank: us[us.length - 1], len: n };
    }
  }
  return null;
}

// 炸弹等级：轰牌2 > 炸弹1 > 普通0
export function bombLevel(combo) {
  if (combo.kind === 'quad') return 2;
  if (combo.kind === 'triple') return 1;
  return 0;
}

// a 是否能压过 b（b 为 null 表示首出，任意合法牌型均可）
export function canBeat(a, b) {
  if (!b) return true;
  const ba = bombLevel(a), bb = bombLevel(b);
  if (ba !== bb) return ba > bb;
  if (ba > 0) return a.rank > b.rank; // 同为炸弹比点数
  return a.kind === b.kind && a.len === b.len && a.rank > b.rank;
}

export function comboName(c) {
  switch (c.kind) {
    case 'single': return '单张';
    case 'pair': return '对子';
    case 'triple': return '三张(炸弹)';
    case 'quad': return '四张(轰牌)';
    case 'straight': return `${c.len}张顺子`;
    case 'pairs': return `${c.len / 2}连对`;
    default: return '';
  }
}

// 名次叫法：头科 / 二科… / 大落
export function posName(pos, n) {
  if (pos === 1) return '头科';
  if (pos === n) return '大落';
  return ['一', '二', '三', '四', '五', '六'][pos - 1] + '科';
}

// 出牌提示：找一组能压过 combo 的最小牌；combo 为 null 时给最小首出建议
export function findHint(hand, combo) {
  const byRank = new Map();
  for (const c of hand) {
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
  }
  const groups = [...byRank.entries()].sort((a, b) => a[0] - b[0]);
  if (!groups.length) return null;

  if (!combo) return [groups[0][1][0]]; // 首出：最小单张

  switch (combo.kind) {
    case 'single': {
      const g = groups.find(g => g[0] > combo.rank);
      if (g) return [g[1][0]];
      break;
    }
    case 'pair': case 'triple': case 'quad': {
      const need = combo.kind === 'pair' ? 2 : combo.kind === 'triple' ? 3 : 4;
      const g = groups.find(g => g[0] > combo.rank && g[1].length >= need);
      if (g) return g[1].slice(0, need);
      break;
    }
    case 'straight': {
      const len = combo.len;
      for (let hi = combo.rank + 1; hi <= 14; hi++) {
        const lo = hi - len + 1;
        if (lo < 3) continue;
        if (rangeOk(byRank, lo, hi, 1)) return takeRange(byRank, lo, hi, 1);
      }
      break;
    }
    case 'pairs': {
      const pairs = combo.len / 2;
      for (let hi = combo.rank + 1; hi <= 14; hi++) {
        const lo = hi - pairs + 1;
        if (lo < 3) continue;
        if (rangeOk(byRank, lo, hi, 2)) return takeRange(byRank, lo, hi, 2);
      }
      break;
    }
  }

  // 压不过就尝试用炸弹兜底
  if (bombLevel(combo) < 1) {
    const g = groups.find(g => g[1].length >= 3);
    if (g) return g[1].slice(0, 3);
  }
  if (bombLevel(combo) < 2) {
    const g = groups.find(g => g[1].length >= 4);
    if (g) return g[1].slice(0, 4);
  }
  return null;
}

function rangeOk(byRank, lo, hi, per) {
  for (let r = lo; r <= hi; r++) {
    const g = byRank.get(r);
    if (!g || g.length < per) return false;
  }
  return true;
}

function takeRange(byRank, lo, hi, per) {
  const out = [];
  for (let r = lo; r <= hi; r++) out.push(...byRank.get(r).slice(0, per));
  return out;
}
