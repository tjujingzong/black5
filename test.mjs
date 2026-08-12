// Node 冒烟测试：牌型规则 + 5 人完整对局模拟（bot 自动打完）
import { Game, AVATAR_IDS, PASS_PHRASES, TURN_SECONDS } from './public/js/engine.js';
import { classify, canBeat, findHint } from './public/js/rules.js';
import { BLACK5_ID, sortHand } from './public/js/cards.js';
import { comboSpeech, speechLanguage } from './public/js/speech.js';

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
ok(classify([C(15), C(3), C(4)]).kind === 'straight', '2-3-4 是最小顺子');
ok(classify([C(3), C(4), C(5)]).kind === 'straight', '3-4-5 顺子合法');
ok(classify([C(3), C(4), C(6)]).kind === 'straight', '3-4-6 顺子合法');
ok(classify([C(4), C(5), C(6)]).kind === 'straight', '4-5-6 顺子合法');
ok(classify([C(4), C(6), C(7)]).kind === 'straight', '4-6-7 顺子合法');
ok(classify([C(5), C(6), C(7)]).kind === 'straight', '5-6-7 顺子合法');
ok(classify([C(3), C(4), C(5), C(6), C(7)]).kind === 'straight', '3-4-5-6-7 长顺子合法');
ok(classify([C(12), C(13), C(14)]).kind === 'straight', 'Q-K-A 是最大顺子');
ok(classify([C(13), C(14), C(15)]) === null, 'K-A-2 不是顺子');
ok(classify([C(15), C(3), C(4), C(6)]).kind === 'straight', '2-3-4-6 长顺子合法');
ok(classify([C(15), C(3), C(5)]) === null, '2-3-5 缺少 4，不是顺子');
ok(classify([C(4, 0), C(4, 1), C(6, 2), C(6, 3)]).kind === 'pairs', '4-4-6-6 姊妹对合法');
ok(classify([C(8, 0), C(8, 1), C(9, 2), C(9, 3), C(10, 0), C(10, 1)]).kind === 'pairs', '8-8-9-9-10-10 三组姊妹对合法');
ok(classify([C(13, 0), C(13, 1), C(14, 2), C(14, 3)]).kind === 'pairs', 'K-K-A-A 是最大两组姊妹对');
ok(classify([C(12, 0), C(12, 1), C(13, 2), C(13, 3), C(14, 0), C(14, 1)]).kind === 'pairs', 'Q-Q-K-K-A-A 是最大三组姊妹对');
ok(classify([C(15, 0), C(15, 1), C(3, 2), C(3, 3)]) === null, '姊妹对不能使用 2 和 3');
ok(classify([C(3, 0), C(3, 1), C(4, 2), C(4, 3)]) === null, '姊妹对不能使用 3');
ok(classify([C(4, 0), C(4, 1), C(5, 2), C(5, 3)]) === null, '姊妹对不能使用 5');
ok(classify([C(14, 0), C(14, 1), C(15, 2), C(15, 3)]) === null, '姊妹对不能使用 2');
ok(classify([C(4, 0), C(4, 1), C(6, 2), C(6, 3), C(7, 0), C(7, 1), C(8, 2), C(8, 3)]) === null, '姊妹对最多三组');
ok(classify([C(3), C(5), C(7)]) === null, '不连续不是顺子');

console.log('== 比大小 ==');
ok(canBeat({ kind: 'triple', rank: 5, len: 3 }, { kind: 'straight', rank: 14, len: 5 }), '炸弹压顺子');
ok(canBeat({ kind: 'quad', rank: 4, len: 4 }, { kind: 'triple', rank: 14, len: 3 }), '轰牌压炸弹');
ok(!canBeat({ kind: 'single', rank: 15, len: 1 }, { kind: 'single', rank: 15, len: 1 }), '同点不能压');
ok(!canBeat({ kind: 'straight', rank: 10, len: 4 }, { kind: 'straight', rank: 10, len: 5 }), '不同长度顺子不能互压');
ok(canBeat({ kind: 'straight', rank: 5, len: 3 }, { kind: 'straight', rank: 4, len: 3 }), '3-4-5 能压 2-3-4');
ok(canBeat({ kind: 'straight', rank: 6, len: 3 }, { kind: 'straight', rank: 5, len: 3 }), '3-4-6 能压 3-4-5');
ok(!canBeat({ kind: 'straight', rank: 6, len: 3 }, { kind: 'straight', rank: 6, len: 3 }), '3-4-6 与 4-5-6 同级，不能互压');
ok(canBeat({ kind: 'straight', rank: 6, len: 3 }, { kind: 'straight', rank: 4, len: 3 }), '3-4-6 能压 2-3-4');
ok(!canBeat({ kind: 'straight', rank: 4, len: 3 }, { kind: 'straight', rank: 14, len: 3 }), '2-3-4 不能压 Q-K-A');
ok(canBeat({ kind: 'pairs', rank: 14, len: 4 }, { kind: 'pairs', rank: 13, len: 4 }), 'K-K-A-A 能压 Q-Q-K-K');
ok(!canBeat({ kind: 'pairs', rank: 14, len: 4 }, { kind: 'pairs', rank: 14, len: 4 }), 'K-K-A-A 不能被同级姊妹对压住');
ok(canBeat({ kind: 'triple', rank: 4, len: 3 }, { kind: 'pairs', rank: 14, len: 4 }), '炸弹可以压最大姊妹对');
ok(canBeat({ kind: 'pair', rank: 15, len: 2 }, { kind: 'pair', rank: 14, len: 2 }), '对2 > 对A');
ok(canBeat({ kind: 'single', rank: 3, len: 1 }, { kind: 'single', rank: 15, len: 1 }), '3 > 2');
ok(canBeat({ kind: 'single', rank: 5, len: 1 }, { kind: 'single', rank: 4, len: 1 }), '5 > 4');
ok(canBeat({ kind: 'single', rank: 5, len: 1 }, { kind: 'single', rank: 5, len: 1 }), '5 可以压 5');
ok(canBeat({ kind: 'pair', rank: 5, len: 2 }, { kind: 'pair', rank: 5, len: 2 }), '对5 可以压对5');
ok(!canBeat({ kind: 'single', rank: 6, len: 1 }, { kind: 'single', rank: 5, len: 1 }), '6 不能压 5');

const ordered = [C(5), C(3), C(15), C(6), C(14), C(4)];
sortHand(ordered);
ok(ordered.map(c => c.rank).join(',') === '4,6,14,15,3,5', '手牌按 4、6…A、2、3、5 排序');

const fiveHint = findHint([C(5, 1)], { kind: 'single', rank: 5, len: 1 });
ok(fiveHint && fiveHint[0].rank === 5, '提示能找到另一张 5 压 5');
const lowStraightHint = findHint([C(15), C(3), C(4)], null);
ok(lowStraightHint && lowStraightHint.length === 1, '首出提示仍优先最小单张');
const nextStraightHint = findHint(
  [C(3), C(4), C(6), C(8)],
  { kind: 'straight', rank: 4, len: 3 },
);
ok(nextStraightHint?.map(card => card.rank).join(',') === '3,4,6', '顺子提示能用 3-4-6 压 2-3-4');
const withFiveHint = findHint(
  [C(3), C(4), C(5), C(6)],
  { kind: 'straight', rank: 4, len: 3 },
);
ok(withFiveHint?.map(card => card.rank).join(',') === '3,4,5', '顺子提示优先用 3-4-5 压 2-3-4');
const preserveFiveHint = findHint(
  [C(3), C(4), C(5), C(6)],
  { kind: 'straight', rank: 5, len: 3 },
);
ok(preserveFiveHint?.map(card => card.rank).join(',') === '3,4,6', '同级顺子提示优先跳过并保留 5');
const sisterPairHint = findHint(
  [C(6, 0), C(6, 1), C(7, 2), C(7, 3)],
  { kind: 'pairs', rank: 6, len: 4 },
);
ok(sisterPairHint?.map(card => card.rank).join(',') === '6,6,7,7', '提示能找到 6-6-7-7 压 4-4-6-6');

console.log('== 出牌播报 ==');
for (const rank of [15, 3, 4, 5]) {
  ok(comboSpeech({ kind: 'single', rank }) === ({ 15: '2', 3: '3', 4: '4', 5: '5' })[rank], `单张 ${rank === 15 ? 2 : rank} 点数播报`);
}
ok(comboSpeech({ kind: 'single', rank: 11 }) === '勾', 'J 点数播报为勾');
ok(comboSpeech({ kind: 'single', rank: 14 }) === '尖', 'A 点数播报为尖');
ok(comboSpeech({ kind: 'pair', rank: 14 }) === '对尖', '对子 A 播报为对尖');
ok(comboSpeech({ kind: 'straight', rank: 14 }) === '顺子', '顺子牌型播报');
ok(comboSpeech({ kind: 'pairs', rank: 13 }) === '姊妹对', '姊妹对牌型播报');
ok(comboSpeech({ kind: 'triple', rank: 9 }) === '三个9，炸弹', '三张炸弹播报');
ok(comboSpeech({ kind: 'quad', rank: 10 }) === '四个10，轰牌', '四张轰牌播报');
ok(speechLanguage('pass') === 'en-US' && speechLanguage('要不起') === 'zh-CN'
  && speechLanguage('5') === 'zh-CN', '过牌语音自动选择中英文发音，牌面数字保持中文');

console.log('== 客户端黑五音效 ==');
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const spokenByBrowser = [];
globalThis.SpeechSynthesisUtterance = class {
  constructor(text) { this.text = text; }
};
globalThis.speechSynthesis = {
  resume: () => {},
  cancel: () => {},
  getVoices: () => [],
  speak: utterance => spokenByBrowser.push(utterance.text),
};
globalThis.AudioContext = class {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 44100; }
  createGain() { return { gain: { value: 0, setTargetAtTime: () => {} }, connect: () => {} }; }
  createBuffer() { return {}; }
  createBufferSource() { return { connect: () => {}, start: () => {} }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
};
const { gameAudio, MUSIC_TRACKS, EFFECT_MEDIA_SOURCES, VOICE_MEDIA_SOURCES } = await import('./public/js/audio.js');
gameAudio.unlock(true);
await Promise.resolve();
ok(gameAudio.context?.state === 'running' && gameAudio.userActivated && gameAudio.speechPrimed,
  '首次触摸会同时解锁移动端 Web Audio 和语音');
ok(MUSIC_TRACKS.length === 3 && new Set(MUSIC_TRACKS.map(track => track.src)).size === 3,
  '随机 BGM 曲库包含三首不重复的本地音乐');
ok(EFFECT_MEDIA_SOURCES.play.endsWith('/play.wav') && EFFECT_MEDIA_SOURCES.card.endsWith('/card.wav')
  && VOICE_MEDIA_SOURCES['快点吧，我等得花儿都谢了'].endsWith('/quick-hurry.wav')
  && VOICE_MEDIA_SOURCES['你的牌打得太好了'].endsWith('/quick-good-play.wav')
  && VOICE_MEDIA_SOURCES['就这？'].endsWith('/quick-just-this.wav'),
  '手机牌局音效和快捷语音均使用本地媒体文件');
const blackFiveTones = [];
gameAudio.context = { state: 'running', currentTime: 10 };
gameAudio.effectGain = {};
gameAudio.effectsEnabled = true;
gameAudio.voice = (...args) => blackFiveTones.push(args);
gameAudio.play('blackFive');
ok(blackFiveTones.length === 3, '黑五专属音效包含三段警示音色');

gameAudio.pendingEffects = [];
gameAudio.context = null;
gameAudio.userActivated = false;
gameAudio.play('card');
ok(gameAudio.pendingEffects[0] === 'card', '音效在移动端解锁完成前进入待播放队列');
gameAudio.context = { state: 'running', currentTime: 10 };
gameAudio.userActivated = true;
gameAudio.flushEffects();
ok(gameAudio.pendingEffects.length === 0, '解锁完成后会补播等待中的牌局音效');

gameAudio.pendingSpeech = [];
gameAudio.userActivated = false;
gameAudio.speak('一个小单张，不走不健康');
ok(gameAudio.pendingSpeech.length === 1, '快捷语音在首次触摸前进入待播放队列');
gameAudio.userActivated = true;
gameAudio.flushSpeech();
ok(spokenByBrowser.includes('一个小单张，不走不健康'), '首次触摸后会补播等待中的快捷语音');

const audioCalls = [];
const spoken = [];
gameAudio.play = name => audioCalls.push(name);
gameAudio.speak = text => spoken.push(text);
gameAudio.announce = combo => audioCalls.push(`announce:${combo.kind}`);
const audioView = {
  phase: 'playing', round: 1, players: [], turnSeat: 0, mySeat: 0,
  pending: null, chat: [], lastInteraction: null, audioEvent: null,
};
gameAudio.lastState = null;
gameAudio.observe(audioView);
gameAudio.observe({ ...audioView, audioEvent: { id: 1, type: 'blackFive', text: '黑五现身' } });
gameAudio.observe({
  ...audioView,
  audioEvent: { id: 2, type: 'play', combo: { kind: 'single', rank: 5, len: 1 }, blackFive: true },
});
ok(audioCalls.filter(name => name === 'blackFive').length === 2
  && spoken.filter(text => text === '黑五现身').length === 2,
  '自爆黑五与打出黑桃5都会触发专属音效和语音');

console.log('== 计分与人机 ==');
// 平局：庄家阵营一头科一大落，名次分相抵
const zeroGame = new Game();
zeroGame.players = [
  { id: 'd', name: '庄家', hand: [], outRank: 1, score: 10 },
  { id: 'b', name: '黑五', hand: [], outRank: 3, score: 10 },
  { id: 'x', name: '闲家', hand: [], outRank: 2, score: 10 },
];
zeroGame.dealer = 0;
zeroGame.blackFiveSeat = 1;
zeroGame.solo = false;
zeroGame.winTeam = 'A';
zeroGame.rankCount = 3;
zeroGame.phase = 'playing';
zeroGame.finishRound();
ok(zeroGame.result.zeroRound && zeroGame.result.rows.every(row => row.delta === 0), '阵营一头科一大落名次相抵为平局，全员 0 分');
ok(zeroGame.players.every(player => player.score === 10), '平局不改变累计积分');

// 独庄庄家头科为红庄，应加分（非平局）
const soloWinGame = new Game();
soloWinGame.players = [
  { id: 'd', name: '庄家', hand: [], outRank: 1, score: 0 },
  { id: 'x', name: '闲家甲', hand: [], outRank: 2, score: 0 },
  { id: 'y', name: '闲家乙', hand: [], outRank: 3, score: 0 },
];
soloWinGame.dealer = 0;
soloWinGame.blackFiveSeat = 0;
soloWinGame.solo = true;
soloWinGame.winTeam = 'A';
soloWinGame.rankCount = 3;
soloWinGame.phase = 'playing';
soloWinGame.finishRound();
ok(!soloWinGame.result.zeroRound, '独庄庄家头科为红庄，非平局');
ok(soloWinGame.players[0].score > 0, '独庄庄家头科应加分');

const scoredGame = new Game();
scoredGame.players = [
  { id: 'd', name: '庄家', hand: [], outRank: 4, score: 0 },
  { id: 'b', name: '黑五', hand: [], outRank: 2, score: 0 },
  { id: 'x', name: '闲家甲', hand: [], outRank: 1, score: 0 },
  { id: 'y', name: '闲家乙', hand: [], outRank: 3, score: 0 },
];
scoredGame.dealer = 0;
scoredGame.blackFiveSeat = 1;
scoredGame.solo = false;
scoredGame.winTeam = 'B';
scoredGame.rankCount = 4;
scoredGame.phase = 'playing';
scoredGame.finishRound();
ok(!scoredGame.result.zeroRound && scoredGame.result.rows.some(row => row.delta !== 0), '庄家大落时按名次正常计分');

const botGame = new Game();
const hostId = botGame.join('测试员').player.id;
ok(botGame.handleMsg(hostId, { t: 'addBot' }) === null, '房主可添加第一名人机');
ok(botGame.handleMsg(hostId, { t: 'addBot' }) === null, '房主可添加第二名人机');
ok(botGame.players.filter(player => player.isBot).length === 2, '人机座位已建立');
const firstBotId = botGame.players.find(player => player.isBot).publicId;
ok(botGame.handleMsg(hostId, { t: 'chat', text: ' 本地联机测试 ' }) === null
  && botGame.chat.at(-1).text === '本地联机测试', '文字聊天会清理首尾空白并保存');
ok(botGame.handleMsg(hostId, { t: 'quick', text: '一个小单张，不走不健康' }) === null
  && botGame.chat.at(-1).quick, '快捷语音按白名单发送');
ok(botGame.handleMsg(hostId, { t: 'quick', text: '你的牌打得太好了' }) === null
  && botGame.handleMsg(hostId, { t: 'quick', text: '就这？' }) === null, '新增快捷语音按白名单发送');
ok(botGame.handleMsg(hostId, { t: 'quick', text: '任意播报' }) === '快捷语音无效', '拒绝伪造的快捷语音');
ok(botGame.handleMsg(hostId, { t: 'voiceStatus', enabled: true }) === null
  && botGame.players[0].voice, '真人语音状态会同步');
ok(botGame.handleMsg(hostId, { t: 'interact', to: firstBotId, item: 'tomato' }) === null
  && botGame.lastInteraction.item === 'tomato', '番茄互动会生成同步事件');
ok(botGame.handleMsg(hostId, { t: 'interact', to: botGame.players[0].publicId, item: 'bucket' }) === '不能对自己使用道具', '不能对自己使用互动道具');
const hostView = botGame.viewFor(hostId);
ok(hostView.myId !== hostId && hostView.players.every(player => player.id !== hostId), '公开玩家 ID 不泄露断线重连令牌');
ok(botGame.handleMsg(hostId, { t: 'start' }) === null, '一名真人加两名人机可开始游戏');
ok(new Set(botGame.players.map(player => player.avatar)).size === botGame.players.length
  && botGame.players.every(player => AVATAR_IDS.includes(player.avatar)), '每局为玩家分配不重复的素材头像');
ok(botGame.viewFor(hostId).players.every(player => AVATAR_IDS.includes(player.avatar)), '头像编号同步到玩家视图');
let botSteps = 0;
while (botGame.phase === 'playing' && botSteps < 5000) {
  const player = botGame.players[botGame.turn];
  if (player.isBot) botGame.actBot();
  else {
    const hint = findHint(player.hand, botGame.pending ? botGame.pending.combo : null);
    if (hint) botGame.play(player.id, hint.map(card => card.id));
    else botGame.pass(player.id);
  }
  botSteps++;
}
ok(botGame.phase === 'roundEnd', `人机对局正常结束（${botSteps} 步）`);

const passGame = new Game();
const passIds = ['甲', '乙', '丙'].map(name => passGame.join(name).player.id);
passGame.phase = 'playing';
passGame.turn = 0;
passGame.pending = { seat: 1, combo: { kind: 'single', rank: 6, len: 1 }, cards: [] };
ok(passGame.pass(passIds[0]) === null
  && passGame.lastAudioEvent.type === 'pass'
  && PASS_PHRASES.includes(passGame.lastAudioEvent.text)
  && passGame.lastActions[0].voice === passGame.lastAudioEvent.text, '过牌随机播报会写入权威音频事件');

const revealGame = new Game();
const revealIds = ['甲', '乙', '丙'].map(name => revealGame.join(name).player.id);
revealGame.phase = 'playing';
revealGame.blackFiveSeat = 0;
ok(revealGame.reveal(revealIds[0]) === null
  && revealGame.blackFivePublic
  && revealGame.lastAudioEvent.type === 'blackFive'
  && revealGame.lastAudioEvent.text === '黑五现身', '自爆黑五会生成同步音效事件');

const blackFiveGame = new Game();
const blackFiveIds = ['甲', '乙', '丙'].map(name => blackFiveGame.join(name).player.id);
blackFiveGame.phase = 'playing';
blackFiveGame.turn = 0;
blackFiveGame.blackFiveSeat = 0;
blackFiveGame.players[0].hand = [C(5)];
blackFiveGame.players[1].hand = [C(6)];
blackFiveGame.players[2].hand = [C(7)];
ok(blackFiveGame.play(blackFiveIds[0], [BLACK5_ID]) === null
  && blackFiveGame.blackFivePublic
  && blackFiveGame.lastAudioEvent.type === 'play'
  && blackFiveGame.lastAudioEvent.blackFive === true, '打出黑桃5会生成专属音效标记');

console.log('== 20 秒出牌倒计时 ==');
const timeoutPassGame = new Game();
const timeoutPassIds = ['甲', '乙', '丙'].map(name => timeoutPassGame.join(name).player.id);
timeoutPassGame.phase = 'playing';
timeoutPassGame.turn = 0;
timeoutPassGame.pending = { seat: 1, combo: { kind: 'single', rank: 6, len: 1 }, cards: [C(6)] };
timeoutPassGame.players.forEach((player, index) => { player.hand = [C(7 + index, index)]; player.outRank = null; });
timeoutPassGame.turnDeadline = Date.now() - 1;
ok(timeoutPassGame.timeoutTurn()
  && timeoutPassGame.lastActions[0].type === 'pass'
  && timeoutPassGame.lastActions[0].timeout
  && timeoutPassGame.turn === 1,
  '有待压牌时超时会自动过牌并推进回合');

const timeoutLeadGame = new Game();
const timeoutLeadIds = ['甲', '乙', '丙'].map(name => timeoutLeadGame.join(name).player.id);
timeoutLeadGame.phase = 'playing';
timeoutLeadGame.turn = 0;
timeoutLeadGame.players[0].hand = [C(5), C(4, 1)];
timeoutLeadGame.players[1].hand = [C(6, 2)];
timeoutLeadGame.players[2].hand = [C(7, 3)];
timeoutLeadGame.turnDeadline = Date.now() - 1;
ok(timeoutLeadGame.timeoutTurn()
  && timeoutLeadGame.pending.cards[0].rank === 4
  && timeoutLeadGame.lastActions[0].timeout,
  '必须首出时超时会自动打出最小单张');
const timeoutView = timeoutLeadGame.viewFor(timeoutLeadIds[0]);
ok(timeoutView.turnSeconds === TURN_SECONDS
  && timeoutView.turnDeadline > timeoutView.serverNow,
  '玩家视图同步 20 秒截止时间和服务器时钟');

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
