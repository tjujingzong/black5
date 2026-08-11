// 界面渲染：完全由 Cloudflare 房间服务下发的玩家视图驱动。
import { classify, canBeat, findHint, posName } from './rules.js';
import { SUITS, rankChar } from './cards.js';

let cur = null;          // 当前视图
let send = () => {};     // 通过 WebSocket 向权威房间服务发送动作
let roomCode = '';
const selected = new Set(); // 选中的手牌 id

export function bindSend(fn) { send = fn; }
export function setRoomInfo(code) {
  roomCode = code;
  const el = document.getElementById('room-code');
  if (el) el.textContent = code;
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mini(c) {
  return `<span class="mcard${(c.suit === 1 || c.suit === 3) ? ' red' : ''}">${SUITS[c.suit]}${rankChar(c.rank)}</span>`;
}

function tableCard(c) {
  const red = c.suit === 1 || c.suit === 3;
  return `<div class="table-card${red ? ' red' : ''}">
    <span class="table-rank">${rankChar(c.rank)}</span>
    <span class="table-suit">${SUITS[c.suit]}</span>
  </div>`;
}

/* ---------------- 事件绑定 ---------------- */

export function init() {
  document.getElementById('btn-copy').addEventListener('click', () => {
    const link = `${location.origin}${location.pathname}?room=${roomCode}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link)
        .then(() => toast('邀请链接已复制'))
        .catch(() => toast('复制失败，房间号：' + roomCode));
    } else toast('房间号：' + roomCode);
  });

  document.getElementById('room-body').addEventListener('click', e => {
    const card = e.target.closest('[data-card]');
    if (card) {
      const id = card.dataset.card;
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      if (cur) render(cur);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    handleAct(btn.dataset.act);
  });
}

function handleAct(act) {
  const v = cur;
  if (!v) return;
  const me = v.players.find(p => p.isMe);
  switch (act) {
    case 'ready': send({ t: 'ready', ready: !me.ready }); break;
    case 'start': send({ t: 'start' }); break;
    case 'next': send({ t: 'next' }); break;
    case 'lobby': send({ t: 'toLobby' }); break;
    case 'reveal': send({ t: 'reveal' }); break;
    case 'hint': {
      const myTurn = v.phase === 'playing' && v.turnSeat === v.mySeat;
      if (!myTurn) return toast('还没轮到你出牌');
      const hint = findHint(v.myHand, v.pending ? v.pending.combo : null);
      if (hint && hint.length) {
        selected.clear();
        hint.forEach(c => selected.add(c.id));
        render(v);
      } else toast('没有能压过的牌，请点“过牌”');
      break;
    }
    case 'play': {
      const cards = v.myHand.filter(c => selected.has(c.id));
      if (!cards.length) {
        const myTurn = v.phase === 'playing' && v.turnSeat === v.mySeat;
        if (myTurn && v.pending) {
          send({ t: 'pass' });
          return;
        }
        return toast('请先选择要出的牌');
      }
      const combo = classify(cards);
      if (!combo) return toast('不是合法牌型');
      if (v.pending && v.pending.seat !== v.mySeat && !canBeat(combo, v.pending.combo)) {
        return toast('压不过当前的牌');
      }
      send({ t: 'play', ids: cards.map(c => c.id) });
      selected.clear();
      break;
    }
  }
}

/* ---------------- 渲染 ---------------- */

export function render(v) {
  cur = v;
  // 清理已不在手牌中的选中项
  const ids = new Set(v.myHand.map(c => c.id));
  for (const id of [...selected]) if (!ids.has(id)) selected.delete(id);

  const body = document.getElementById('room-body');
  if (v.phase === 'gone') {
    body.innerHTML = '<div class="banner">你已不在房间中，请刷新页面</div>';
    return;
  }
  let html = '';
  if (v.phase === 'lobby') html += lobbyHtml(v);
  else {
    html += gameHtml(v);
    if (v.phase === 'roundEnd' && v.result) html += resultHtml(v);
  }
  html += `<div class="logbox"><ul>${v.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
  body.innerHTML = html;
}

function lobbyHtml(v) {
  const me = v.players.find(p => p.isMe);
  const list = v.players.map(p => `
    <li class="${p.connected ? '' : 'off'}">
      <span class="pname">${esc(p.name)}${p.isMe ? '（我）' : ''}</span>
      <span class="pstate">${p.isRoomOwner ? '👑 房主' : p.ready ? '✅ 已准备' : '⏳ 未准备'}</span>
    </li>`).join('');
  const actions = v.isHost
    ? `<button class="primary big" data-act="start" ${v.canStart ? '' : 'disabled'}>开始游戏</button>
       <p class="tip">${v.canStart ? '全员已准备，可以开局！' : `等待玩家准备（需 ${v.minPlayers}~${v.maxPlayers} 人，推荐 5 人）`}</p>`
    : `<button class="primary big" data-act="ready">${me.ready ? '取消准备' : '准备'}</button>
       <p class="tip">等待房主开始游戏…</p>`;
  return `<div class="lobby">
    <h2>房间 ${esc(roomCode)}</h2>
    <p class="tip">把房间号或右上角的邀请链接发给朋友即可加入</p>
    <ul class="plist">${list}</ul>
    <div class="actions-col">${actions}</div>
  </div>`;
}

function gameHtml(v) {
  const seatName = s => (v.players[s] ? esc(v.players[s].name) : '?');
  const offline = v.players.filter(p => !p.connected);
  const opponents = [];
  for (let offset = 1; offset < v.players.length; offset++) {
    opponents.push(v.players[(v.mySeat + offset) % v.players.length]);
  }
  const positions = {
    1: ['seat-top'],
    2: ['seat-top-left', 'seat-top-right'],
    3: ['seat-left', 'seat-top', 'seat-right'],
    4: ['seat-left-high', 'seat-left-low', 'seat-right-high', 'seat-right-low'],
    5: ['seat-left-high', 'seat-left-low', 'seat-top', 'seat-right-high', 'seat-right-low'],
  }[opponents.length] || [];
  const chips = opponents.map((player, index) => chipHtml(v, player, positions[index])).join('');
  const myTurn = v.phase === 'playing' && v.turnSeat === v.mySeat;

  const center = v.pending
    ? `<div class="trick-owner"><b>${seatName(v.pending.seat)}</b><span>${v.pending.name}</span></div>
       <div class="table-cards">${v.pending.cards.map(tableCard).join('')}</div>`
    : `<div class="table-empty">${myTurn ? '由你首出' : `等待 ${seatName(v.turnSeat)} 出牌`}</div>`;

  const myLa = v.lastActions[v.mySeat];
  const myAct = myLa ? (myLa.type === 'pass' ? '你：过牌' : `你：${myLa.cards.map(mini).join('')}`) : '';

  let secret = '';
  if (v.mySecret) {
    secret = v.mySecret.solo
      ? '<div class="secret"><b>♠5</b> 你拿到了黑桃5 —— 本局独庄，独自对抗所有闲家！</div>'
      : '<div class="secret"><b>♠5</b> 你是黑五（黑桃5持有者），是庄家的秘密队友，可择机明牌</div>';
  }

  const hand = v.myHand.map(c => `
    <div class="card${(c.suit === 1 || c.suit === 3) ? ' red' : ''}${selected.has(c.id) ? ' sel' : ''}" data-card="${c.id}">
      <span class="cr">${rankChar(c.rank)}</span><span class="cs">${SUITS[c.suit]}</span>
    </div>`).join('');

  const canPass = myTurn && !!v.pending;
  const playLabel = selected.size > 0 ? '出牌' : canPass ? '过牌' : '出牌';
  const status = v.phase !== 'playing' ? '本局已结束' : myTurn ? '轮到你出牌' : `等待 ${seatName(v.turnSeat)} 出牌`;

  return `<div class="game">
    <div class="topline">
      <span>第 ${v.round} 局</span><span>庄家：${seatName(v.dealerSeat)}</span><span>${status}</span>
    </div>
    ${offline.length ? `<div class="banner">⚠ ${offline.map(p => esc(p.name)).join('、')} 掉线，等待重新连接…</div>` : ''}
    <div class="table-wrap">
      <div class="table-felt">
        ${chips}
        <div class="table-center">
          ${center}
          <div class="table-turn${myTurn ? ' mine' : ''}">${status}</div>
        </div>
      </div>
    </div>
    ${secret}
    <div class="self-zone">
      <div class="myact">${myAct}</div>
      <div class="hand">${hand}</div>
      <div class="controls">
        <button data-act="hint" ${myTurn ? '' : 'disabled'}>提示</button>
        ${v.canReveal ? '<button class="accent" data-act="reveal">明牌：我是黑五</button>' : ''}
        <button class="primary" data-act="play" ${myTurn ? '' : 'disabled'}>${playLabel}</button>
      </div>
    </div>
  </div>`;
}

function chipHtml(v, p, position) {
  const seat = v.players.indexOf(p);
  const la = v.lastActions[seat];
  const turn = v.phase === 'playing' && v.turnSeat === seat;
  const cls = ['chip', position];
  if (turn) cls.push('turn');
  if (!p.connected) cls.push('off');
  if (p.outRank) cls.push('out');
  let tags = '';
  if (p.isDealer) tags += '<i class="tag dealer">庄</i>';
  if (p.isBlackFive) tags += '<i class="tag b5">黑五</i>';
  if (v.publicSolo && p.isDealer) tags += '<i class="tag solo">独庄</i>';
  const meta = p.outRank
    ? `<span class="meta finish">${posName(p.outRank, v.n)}</span>`
    : `<span class="meta">${p.count} 张</span>`;
  const act = la
    ? (la.type === 'pass' ? '<span class="act pass">过牌</span>' : '<span class="act">已出牌</span>')
    : '';
  return `<div class="${cls.join(' ')}">
    <div class="cname">${esc(p.name)}${tags}</div>
    ${meta}${p.connected ? '' : '<span class="meta off-tag">⚠ 离线</span>'}
    <div class="cact">${act}</div>
    <div class="cscore">积分 ${p.score}</div>
  </div>`;
}

function resultHtml(v) {
  const r = v.result;
  const rows = r.rows.map(x => `
    <tr>
      <td>${x.posName}</td><td>${esc(x.name)}</td><td>${x.team}</td>
      <td class="${x.delta >= 0 ? 'plus' : 'minus'}">${x.delta >= 0 ? '+' : ''}${x.delta}</td>
      <td>${x.score}</td>
    </tr>`).join('');
  const win = r.winTeam === 'A' ? '庄家阵营获胜' : '闲家阵营获胜';
  const b5name = v.blackFiveSeat != null && v.players[v.blackFiveSeat] ? esc(v.players[v.blackFiveSeat].name) : '—';
  const btns = v.isHost
    ? '<button class="primary big" data-act="next">下一局</button><button data-act="lobby">返回大厅</button>'
    : '<p class="tip">等待房主开始下一局…</p>';
  return `<div class="overlay"><div class="panel">
    <h2>${win}${r.solo ? '（独庄 ×2）' : ''}</h2>
    <p class="tip" style="text-align:center">本局黑五：${b5name}${r.solo ? '（庄家自持黑桃5，独庄）' : ''}</p>
    <table>
      <thead><tr><th>名次</th><th>玩家</th><th>阵营</th><th>本局</th><th>总分</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="actions">${btns}</div>
  </div></div>`;
}
