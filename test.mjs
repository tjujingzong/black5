// Node 冒烟测试：牌型规则 + 5 人完整对局模拟（bot 自动打完）
import { Game } from './public/js/engine.js';
import { classify, canBeat, findHint } from './public/js/rules.js';
import { BLACK5_ID } from './public/js/cards.js';

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.error('  ✗ FAIL:', msg); failed++; }
}

console.log('== 牌型判定 ==');
const C = (rank, suit = 0) => ({ id: `${suit}-${rank}`, rank, suit });
ok(classify([C(7)]).kind === 'single', '单张');
ok(classify([C(9, 0), C(9, 1)]).kind === 'pair', '对子');
ok(classify([C(9, 0), C(9, 1), C(9, 2)]).kind === 'triple', '三张=炸弹');
ok(classify([C(9, 0), C(9, 1), C(9, 2), C(9, 3)]).kind === 'quad', '四张=轰牌');
ok(classify([C(3), C(4), C(5)]).kind === 'straight', '3张顺子合法');
ok(classify([C(12), C(13), C(14), C(15)]) === null, '顺子不能含2');
ok(classify([C(13, 0), C(13, 1), C(14, 2), C(14, 3)]).kind === 'pairs', '连对');
ok(classify([C(3), C(5), C(7)]) === null, '不连续不是顺子');

console.log('== 比大小 ==');
ok(canBeat({ kind: 'triple', rank: 5, len: 3 }, { kind: 'straight', rank: 14, len: 5 }), '炸弹压顺子');
ok(canBeat({ kind: 'quad', rank: 4, len: 4 }, { kind: 'triple', rank: 14, len: 3 }), '轰牌压炸弹');
ok(!canBeat({ kind: 'single', rank: 15, len: 1 }, { kind: 'single', rank: 15, len: 1 }), '同点不能压');
ok(!canBeat({ kind: 'straight', rank: 10, len: 4 }, { kind: 'straight', rank: 10, len: 5 }), '不同长度顺子不能互压');
ok(canBeat({ kind: 'pair', rank: 15, len: 2 }, { kind: 'pair', rank: 14, len: 2 }), '对2 > 对A');

console.log('== 整局模拟（随机 20 局）==');
for (let t = 0; t < 20; t++) {
  const n = t % 3 === 0 ? 4 : 5; // 混合 4 人 / 5 人局
  const g = new Game();
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(g.join('P' + i).player.id);
  for (let i = 1; i < n; i++) g.handleMsg(ids[i], { t: 'ready', ready: true });
  ok(g.handleMsg(ids[0], { t: 'start' }) === null, `第${t + 1}局(${n}人)：开局成功`);

  const counts = g.players.map(p => p.hand.length).sort((a, b) => b - a);
  const total = counts.reduce((a, b) => a + b, 0);
  ok(total === 52, `发牌总数 52（分布 ${counts.join('/')}）`);
  const b5 = g.players.findIndex(p => p.hand.some(c => c.id === BLACK5_ID));
  ok(g.blackFiveSeat === b5, '黑五座位定位正确');
  ok(g.turn === g.dealer, '庄家首出');

  let steps = 0;
  while (g.phase === 'playing' && steps < 5000) {
    const seat = g.turn, p = g.players[seat];
    const hint = findHint(p.hand, g.pending ? g.pending.combo : null);
    const err = hint ? g.play(p.id, hint.map(c => c.id)) : g.pass(p.id);
    if (err) { console.error('  ✗ 行动被拒:', err); failed++; break; }
    steps++;
  }
  ok(g.phase === 'roundEnd', `对局正常结束（${steps} 步）`);
  const ranks = g.players.map(p => p.outRank).sort((a, b) => a - b).join();
  ok(ranks === [...Array(n).keys()].map(i => i + 1).join(), '名次 1..n 完整');
  const deltas = g.result.rows.map(r => r.delta);
  const dA = g.result.rows.filter(r => r.team === '庄家').map(r => r.delta);
  const dB = g.result.rows.filter(r => r.team === '闲家').map(r => r.delta);
  ok(new Set(dA).size === 1 && new Set(dB).size === 1 && dA[0] === -dB[0], `阵营对抗计分对称（庄 ${dA[0]} / 闲 ${dB[0]}）`);
  ok(g.winTeam === 'A' || g.winTeam === 'B', '胜负阵营已判定');

  // 下一局庄家轮替
  const dealer0 = g.dealer;
  g.handleMsg(ids[0], { t: 'next' });
  ok(g.dealer === (dealer0 + 1) % n && g.phase === 'playing', '下一局庄家轮替并重新发牌');
}

if (failed) { console.error(`\n共 ${failed} 处失败`); process.exit(1); }
console.log('\n全部通过 ✅');
