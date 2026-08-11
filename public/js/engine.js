// 权威游戏状态机：浏览器测试与 Cloudflare Durable Object 共用。
// 规则要点：
// - 52 张牌按逆时针从庄家开始轮发 → 5 人时庄家与下家各 11 张、其余各 10 张，人数不同自动适配
// - 黑桃5 持有者为庄家的秘密队友（黑五）；庄家自持黑桃5 为独庄
// - 头科（第一个出完）所在阵营获胜，之后继续决出全部名次用于计分

import { makeDeck, shuffle, sortHand, cardLabel, BLACK5_ID } from './cards.js';
import { classify, canBeat, comboName, posName } from './rules.js';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;

function genToken() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return 'p-' + globalThis.crypto.randomUUID();
  }
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

export class Game {
  constructor() {
    this.players = [];        // 座位顺序即数组下标（对局中不变）
    this.phase = 'lobby';     // lobby | playing | roundEnd
    this.round = 0;
    this.dealer = 0;          // 庄家座位
    this.turn = 0;            // 当前行动座位
    this.pending = null;      // 待压的牌 {seat, combo, cards}
    this.passStreak = 0;      // 自上次出牌以来的连续过牌数
    this.rankCount = 0;       // 已出完的人数
    this.winTeam = null;      // 'A' 庄家阵营 | 'B' 闲家阵营
    this.blackFiveSeat = null;
    this.blackFivePublic = false;
    this.solo = false;        // 独庄
    this.lastActions = {};    // 本圈内每位玩家的最后动作（用于桌面展示）
    this.result = null;
    this.log = [];
  }

  pushLog(msg) {
    this.log.push(msg);
    if (this.log.length > 60) this.log.splice(0, this.log.length - 60);
  }

  /* ---------------- 房间管理 ---------------- */

  join(name, token) {
    name = String(name || '').trim().slice(0, 8) || '玩家';
    if (token) { // 断线重连：凭令牌找回座位
      const p = this.players.find(x => x.id === token);
      if (p) {
        p.connected = true;
        this.pushLog(`${p.name} 重新连接`);
        return { player: p };
      }
    }
    if (this.phase !== 'lobby') return { error: '对局进行中，暂时无法加入' };
    if (this.players.length >= MAX_PLAYERS) return { error: `房间已满（最多 ${MAX_PLAYERS} 人）` };
    const p = { id: genToken(), name, hand: [], ready: false, connected: true, score: 0, outRank: null };
    this.players.push(p);
    this.pushLog(`${name} 加入了房间`);
    return { player: p };
  }

  handleDisconnect(id) {
    const p = this.players.find(x => x.id === id);
    if (!p) return;
    if (this.phase === 'lobby') {
      this.players = this.players.filter(x => x.id !== id);
      this.pushLog(`${p.name} 离开了房间`);
    } else {
      p.connected = false;
      this.pushLog(`${p.name} 掉线，等待重连…`);
    }
  }

  handleMsg(id, msg) {
    if (!this.players.find(x => x.id === id)) return '你不在房间中';
    switch (msg && msg.t) {
      case 'ready': return this.setReady(id, !!msg.ready);
      case 'start': return this.start(id);
      case 'play': return this.play(id, msg.ids);
      case 'pass': return this.pass(id);
      case 'reveal': return this.reveal(id);
      case 'next': return this.next(id);
      case 'toLobby': return this.toLobby(id);
      default: return '未知操作';
    }
  }

  setReady(id, ready) {
    if (this.phase !== 'lobby') return '对局中无法更改准备状态';
    const p = this.players.find(x => x.id === id);
    p.ready = ready;
    if (ready) this.pushLog(`${p.name} 已准备`);
    return null;
  }

  /* ---------------- 开局 ---------------- */

  start(id) {
    if (id !== this.players[0].id) return '只有房主可以开始游戏';
    if (this.phase !== 'lobby') return '游戏已经在进行中';
    if (this.players.length < MIN_PLAYERS) return `至少需要 ${MIN_PLAYERS} 名玩家`;
    if (!this.players.slice(1).every(p => p.ready)) return '还有玩家没有准备';
    this.players.forEach(p => { p.score = 0; });
    this.dealer = Math.floor(Math.random() * this.players.length); // 首局随机庄家
    this.round = 0;
    this.startRound();
    return null;
  }

  startRound() {
    this.round++;
    const n = this.players.length;
    const deck = shuffle(makeDeck());
    this.players.forEach(p => { p.hand = []; p.outRank = null; });
    // 从庄家开始逆时针轮发：庄家与下家自然多拿一张
    deck.forEach((c, i) => this.players[(this.dealer + i) % n].hand.push(c));
    this.players.forEach(p => sortHand(p.hand));

    this.blackFiveSeat = this.players.findIndex(p => p.hand.some(c => c.id === BLACK5_ID));
    this.solo = this.blackFiveSeat === this.dealer;
    this.blackFivePublic = false;
    this.pending = null;
    this.passStreak = 0;
    this.lastActions = {};
    this.rankCount = 0;
    this.winTeam = null;
    this.result = null;
    this.turn = this.dealer; // 庄家首出
    this.phase = 'playing';
    this.pushLog(`—— 第 ${this.round} 局开始，庄家：${this.players[this.dealer].name} ——`);
  }

  /* ---------------- 出牌流程 ---------------- */

  teamSeats() {
    return this.solo ? [this.dealer] : [this.dealer, this.blackFiveSeat];
  }

  nextActive(from) {
    const n = this.players.length;
    let s = from;
    do { s = (s + 1) % n; } while (this.players[s].outRank !== null);
    return s;
  }

  play(id, ids) {
    if (this.phase !== 'playing') return '当前不在对局中';
    const seat = this.players.findIndex(p => p.id === id);
    const p = this.players[seat];
    if (this.turn !== seat) return '还没轮到你出牌';
    if (!Array.isArray(ids) || ids.length === 0) return '请先选择要出的牌';
    if (new Set(ids).size !== ids.length) return '选牌重复';
    const cards = [];
    for (const cid of ids) {
      const c = p.hand.find(x => x.id === cid);
      if (!c) return '选中的牌无效';
      cards.push(c);
    }
    const combo = classify(cards);
    if (!combo) return '不是合法的牌型';
    if (this.pending && this.pending.seat !== seat && !canBeat(combo, this.pending.combo)) {
      return '压不过当前的牌';
    }

    p.hand = p.hand.filter(c => !ids.includes(c.id));
    this.pending = { seat, combo, cards };
    this.passStreak = 0;
    this.lastActions[seat] = { type: 'play', cards, name: comboName(combo) };
    this.pushLog(`${p.name} 出 ${comboName(combo)}：${cards.map(cardLabel).join(' ')}`);

    // 黑桃5 一出手，身份自然暴露
    if (!this.blackFivePublic && cards.some(c => c.id === BLACK5_ID)) {
      this.blackFivePublic = true;
      this.pushLog(`黑桃5现身！${p.name} 就是黑五`);
    }

    if (p.hand.length === 0) this.outSeat(seat);
    if (this.phase === 'playing') this.afterAction();
    return null;
  }

  pass(id) {
    if (this.phase !== 'playing') return '当前不在对局中';
    const seat = this.players.findIndex(p => p.id === id);
    if (this.turn !== seat) return '还没轮到你';
    if (!this.pending) return '本轮由你首出，必须出牌';
    this.passStreak++;
    this.lastActions[seat] = { type: 'pass' };
    this.pushLog(`${this.players[seat].name} 过牌`);
    this.afterAction();
    return null;
  }

  reveal(id) {
    if (this.phase !== 'playing') return '现在不能明牌';
    const seat = this.players.findIndex(p => p.id === id);
    if (seat !== this.blackFiveSeat) return '你没有可亮的身份';
    if (this.blackFivePublic) return '身份已经公开了';
    this.blackFivePublic = true;
    this.pushLog(`${this.players[seat].name} 亮出黑桃5：我就是黑五！`);
    return null;
  }

  // 出牌/过牌之后推进回合
  afterAction() {
    const active = this.players.filter(p => p.outRank === null).length;
    if (active <= 1) { this.finishRound(); return; }
    if (this.pending) {
      const holderOut = this.players[this.pending.seat].outRank !== null;
      // 除最后出牌者外全部过牌 → 本圈结束
      if (this.passStreak >= active - (holderOut ? 0 : 1)) { this.endTrick(); return; }
    }
    this.turn = this.nextActive(this.turn);
  }

  endTrick() {
    const ps = this.pending.seat;
    this.pending = null;
    this.passStreak = 0;
    this.lastActions = {};
    if (this.players[ps].outRank === null) {
      this.turn = ps;
      this.pushLog(`无人压牌，${this.players[ps].name} 继续首出`);
    } else { // 最后出牌者已出完，出牌权交给其下家
      this.turn = this.nextActive(ps);
      this.pushLog(`无人压牌，由 ${this.players[this.turn].name} 首出`);
    }
  }

  outSeat(seat) {
    const p = this.players[seat];
    p.outRank = ++this.rankCount;
    this.pushLog(`${p.name} 出完手牌，${posName(p.outRank, this.players.length)}！`);
    if (this.rankCount === 1) {
      this.winTeam = this.teamSeats().includes(seat) ? 'A' : 'B';
      this.pushLog(`头科诞生 —— ${this.winTeam === 'A' ? '庄家阵营' : '闲家阵营'}获胜！继续决出全部名次`);
    }
  }

  /* ---------------- 结算 ---------------- */

  finishRound() {
    const n = this.players.length;
    const left = this.players.find(p => p.outRank === null);
    if (left) { left.outRank = ++this.rankCount; }
    const teamA = this.teamSeats();
    // 名次基础分：5 人局为 头科+10 / 二科+5 / 三科0 / 四科-5 / 大落-10，其他人数等差展开
    const posPts = pos => (n - 1 - 2 * (pos - 1)) * 5;
    const sumA = teamA.reduce((s, seat) => s + posPts(this.players[seat].outRank), 0);
    const mult = this.solo ? 2 : 1;
    const rows = this.players.map((p, i) => {
      const inA = teamA.includes(i);
      const delta = (inA ? sumA : -sumA) * mult;
      p.score += delta;
      return { name: p.name, pos: p.outRank, posName: posName(p.outRank, n), team: inA ? '庄家' : '闲家', delta, score: p.score };
    }).sort((a, b) => a.pos - b.pos);
    this.blackFivePublic = true; // 结算时公开黑五身份
    this.result = { winTeam: this.winTeam, solo: this.solo, rows };
    this.phase = 'roundEnd';
    this.pushLog(`本局结束：${this.winTeam === 'A' ? '庄家阵营' : '闲家阵营'}获胜${this.solo ? '（独庄，分数翻倍）' : ''}`);
  }

  next(id) {
    if (id !== this.players[0].id) return '只有房主可以开始下一局';
    if (this.phase !== 'roundEnd') return '当前不能开始下一局';
    this.dealer = (this.dealer + 1) % this.players.length; // 庄家轮替
    this.startRound();
    return null;
  }

  toLobby(id) {
    if (id !== this.players[0].id) return '只有房主可以操作';
    if (this.phase !== 'roundEnd') return '当前不能返回大厅';
    this.phase = 'lobby';
    this.round = 0;
    this.result = null;
    this.pending = null;
    this.lastActions = {};
    this.players.forEach(p => { p.ready = false; p.score = 0; p.hand = []; p.outRank = null; });
    this.pushLog('已返回大厅，积分清零');
    return null;
  }

  /* ---------------- 状态视图 ---------------- */

  // 按玩家生成"战争迷雾"视图：只暴露该玩家应看到的信息
  viewFor(id) {
    const me = this.players.find(p => p.id === id);
    if (!me) return { phase: 'gone', myId: id, players: [], myHand: [], log: [] };
    const inGame = this.phase !== 'lobby';
    const mySeat = this.players.indexOf(me);
    return {
      phase: this.phase,
      round: this.round,
      n: this.players.length,
      myId: id,
      isHost: id === this.players[0].id,
      mySeat,
      players: this.players.map((p, i) => ({
        id: p.id, name: p.name, count: p.hand.length, ready: p.ready,
        connected: p.connected, outRank: p.outRank, score: p.score,
        isMe: p.id === id, isRoomOwner: i === 0,
        isDealer: inGame && i === this.dealer,
        isBlackFive: inGame && this.blackFivePublic && i === this.blackFiveSeat,
      })),
      myHand: inGame ? me.hand : [],
      turnSeat: inGame ? this.turn : null,
      dealerSeat: inGame ? this.dealer : null,
      pending: this.pending ? {
        seat: this.pending.seat,
        name: comboName(this.pending.combo),
        cards: this.pending.cards,
        combo: { kind: this.pending.combo.kind, rank: this.pending.combo.rank, len: this.pending.combo.len },
      } : null,
      lastActions: inGame ? this.lastActions : {},
      publicSolo: inGame && this.solo && this.blackFivePublic,
      blackFiveSeat: inGame && this.blackFivePublic ? this.blackFiveSeat : null,
      canReveal: this.phase === 'playing' && !this.blackFivePublic && mySeat === this.blackFiveSeat,
      mySecret: inGame && mySeat === this.blackFiveSeat
        ? { solo: this.solo, dealer: mySeat === this.dealer }
        : null,
      winTeam: this.winTeam,
      result: this.result,
      log: this.log.slice(-9),
      canStart: this.phase === 'lobby'
        && this.players.length >= MIN_PLAYERS
        && this.players.slice(1).every(p => p.ready),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    };
  }
}
