// 界面渲染：完全由 Cloudflare 房间服务下发的玩家视图驱动。
import { classify, canBeat, findHint, posName } from './rules.js';
import { SUITS, rankChar } from './cards.js';
import { QUICK_PHRASES } from './engine.js';

let cur = null;          // 当前视图
let send = () => {};     // 通过 WebSocket 向权威房间服务发送动作
let roomCode = '';
const selected = new Set(); // 选中的手牌 id
let chatDraft = '';
let socialTarget = null;
let lastInteractionId = 0;

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
    const avatar = e.target.closest('[data-player-id]');
    if (avatar && avatar.dataset.playerId !== cur?.myId) {
      socialTarget = avatar.dataset.playerId;
      if (cur) render(cur);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    handleAct(btn.dataset.act, btn);
  });
  document.getElementById('room-body').addEventListener('input', e => {
    if (e.target.matches('[data-chat-input]')) chatDraft = e.target.value;
  });
  document.getElementById('room-body').addEventListener('keydown', e => {
    if (e.target.matches('[data-chat-input]') && e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      handleAct('sendChat');
    }
  });
}

function handleAct(act, button = null) {
  const v = cur;
  if (!v) return;
  const me = v.players.find(p => p.isMe);
  switch (act) {
    case 'ready': send({ t: 'ready', ready: !me.ready }); break;
    case 'start': send({ t: 'start' }); break;
    case 'next': send({ t: 'next' }); break;
    case 'lobby': send({ t: 'toLobby' }); break;
    case 'reveal': send({ t: 'reveal' }); break;
    case 'addBot': send({ t: 'addBot' }); break;
    case 'removeBot': send({ t: 'removeBot' }); break;
    case 'sendChat': {
      const text = chatDraft.replace(/\s+/g, ' ').trim();
      if (!text) return toast('请输入聊天内容');
      send({ t: 'chat', text });
      chatDraft = '';
      render(v);
      break;
    }
    case 'quick': send({ t: 'quick', text: button.dataset.text }); break;
    case 'interact': {
      send({ t: 'interact', to: button.dataset.to, item: button.dataset.item });
      socialTarget = null;
      render(v);
      break;
    }
    case 'closeProp': socialTarget = null; render(v); break;
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
  const chatWasFocused = document.activeElement?.matches?.('[data-chat-input]');
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
  html += chatHtml(v);
  html += `<div class="logbox"><ul>${v.log.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
  body.innerHTML = html;
  const messages = body.querySelector('.chat-messages');
  if (messages) messages.scrollTop = messages.scrollHeight;
  if (chatWasFocused) {
    const input = body.querySelector('[data-chat-input]');
    input?.focus();
    if (input) input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function lobbyHtml(v) {
  const me = v.players.find(p => p.isMe);
  const botCount = v.players.filter(p => p.isBot).length;
  const list = v.players.map(p => `
    <li class="${p.connected ? '' : 'off'}">
      <span class="pname"><span class="lobby-avatar">${avatarChar(p.name)}</span>${esc(p.name)}${p.isMe ? '（我）' : ''}</span>
      <span class="pstate">${p.isBot ? '人机 · 已准备' : p.isRoomOwner ? '房主' : p.ready ? '已准备' : '未准备'}</span>
    </li>`).join('');
  const actions = v.isHost
    ? `<div class="bot-actions">
         <button data-act="addBot" ${v.players.length >= v.maxPlayers ? 'disabled' : ''}>添加人机</button>
         <button data-act="removeBot" ${botCount ? '' : 'disabled'}>移除人机</button>
       </div>
       <button class="primary big" data-act="start" ${v.canStart ? '' : 'disabled'}>开始游戏</button>
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
  const me = v.players[v.mySeat];

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
      <div class="self-profile">
        <span class="avatar-static" data-avatar-id="${esc(me.id)}">${avatarChar(me.name)}</span>
        <span>${esc(me.name)}</span>${me.voice ? '<i class="voice-mark">语音中</i>' : ''}
      </div>
      <div class="myact">${myAct}</div>
      <div class="hand">${hand}</div>
      <div class="controls">
        <button data-act="hint" ${myTurn ? '' : 'disabled'}>提示</button>
        ${v.canReveal ? '<button class="accent" data-act="reveal">明牌：我是黑五</button>' : ''}
        <button class="primary" data-act="play" ${myTurn ? '' : 'disabled'}>${playLabel}</button>
      </div>
    </div>
    ${propMenuHtml(v)}
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
  if (p.isBot) tags += '<i class="tag bot">人机</i>';
  if (p.voice) tags += '<i class="tag voice">语音</i>';
  const meta = p.outRank
    ? `<span class="meta finish">${posName(p.outRank, v.n)}</span>`
    : `<span class="meta">${p.count} 张</span>`;
  const act = la
    ? (la.type === 'pass' ? '<span class="act pass">过牌</span>' : '<span class="act">已出牌</span>')
    : '';
  return `<div class="${cls.join(' ')}">
    <button class="avatar" data-player-id="${esc(p.id)}" data-avatar-id="${esc(p.id)}" aria-label="向${esc(p.name)}使用道具" title="向${esc(p.name)}使用道具">${avatarChar(p.name)}</button>
    <div class="chip-main">
      <div class="cname">${esc(p.name)}${tags}</div>
      ${meta}${p.connected ? '' : '<span class="meta off-tag">离线</span>'}
      <div class="cact">${act}</div>
      <div class="cscore">积分 ${p.score}</div>
    </div>
  </div>`;
}

function avatarChar(name) {
  return esc(Array.from(String(name || '?'))[0] || '?');
}

function propMenuHtml(v) {
  const target = v.players.find(player => player.id === socialTarget && !player.isMe);
  if (!target) return '';
  return `<div class="prop-menu" role="dialog" aria-label="互动道具">
    <span>送给 <b>${esc(target.name)}</b></span>
    <button data-act="interact" data-to="${esc(target.id)}" data-item="tomato">🍅 番茄</button>
    <button data-act="interact" data-to="${esc(target.id)}" data-item="bucket">🪣 水桶</button>
    <button class="icon-close" data-act="closeProp" aria-label="关闭" title="关闭">×</button>
  </div>`;
}

function chatHtml(v) {
  const messages = (v.chat || []).map(message => `
    <div class="chat-message${message.playerId === v.myId ? ' mine' : ''}${message.quick ? ' quick-message' : ''}">
      <b>${esc(message.name)}</b><span>${message.quick ? '🔊 ' : ''}${esc(message.text)}</span>
    </div>`).join('');
  const quick = QUICK_PHRASES.map(text => `<button data-act="quick" data-text="${esc(text)}">${esc(text)}</button>`).join('');
  return `<section class="chat-panel">
    <div class="chat-head"><b>房间聊天</b><div class="quick-phrases">${quick}</div></div>
    <div class="chat-messages">${messages || '<span class="chat-empty">还没有消息</span>'}</div>
    <div class="chat-compose">
      <input data-chat-input maxlength="80" value="${esc(chatDraft)}" placeholder="输入消息" autocomplete="off">
      <button class="primary" data-act="sendChat">发送</button>
    </div>
  </section>`;
}

export function showInteraction(event) {
  if (!event || event.id <= lastInteractionId) return;
  lastInteractionId = event.id;
  const findAvatar = id => [...document.querySelectorAll('[data-avatar-id]')]
    .find(element => element.dataset.avatarId === id);
  const source = findAvatar(event.fromId);
  const target = findAvatar(event.toId);
  if (!target) return;
  const sourceRect = source?.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const startX = sourceRect ? sourceRect.left + sourceRect.width / 2 : innerWidth / 2;
  const startY = sourceRect ? sourceRect.top + sourceRect.height / 2 : innerHeight - 80;
  const endX = targetRect.left + targetRect.width / 2;
  const endY = targetRect.top + targetRect.height / 2;
  const flight = document.createElement('div');
  flight.className = 'prop-flight';
  flight.textContent = event.item === 'tomato' ? '🍅' : '🪣';
  flight.style.left = `${startX}px`;
  flight.style.top = `${startY}px`;
  document.body.appendChild(flight);
  const animation = flight.animate([
    { transform: 'translate(-50%, -50%) scale(.65) rotate(0)' },
    { transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY - 65}px)) scale(1.25) rotate(180deg)`, offset: .65 },
    { transform: `translate(calc(-50% + ${endX - startX}px), calc(-50% + ${endY - startY}px)) scale(.9) rotate(360deg)` },
  ], { duration: 900, easing: 'cubic-bezier(.2,.75,.25,1)', fill: 'forwards' });
  animation.onfinish = () => {
    flight.remove();
    const impact = document.createElement('div');
    impact.className = `prop-impact ${event.item}`;
    impact.textContent = event.item === 'tomato' ? '啪！' : '哗！';
    impact.style.left = `${endX}px`;
    impact.style.top = `${endY}px`;
    document.body.appendChild(impact);
    impact.addEventListener('animationend', () => impact.remove(), { once: true });
  };
}

function resultHtml(v) {
  const r = v.result;
  const rows = r.rows.map(x => `
    <tr>
      <td>${x.posName}</td><td>${esc(x.name)}</td><td>${x.team}</td>
      <td class="${x.delta > 0 ? 'plus' : x.delta < 0 ? 'minus' : ''}">${x.delta > 0 ? '+' : ''}${x.delta}</td>
      <td>${x.score}</td>
    </tr>`).join('');
  const win = r.zeroRound ? '庄家不是大落 · 全员 0 分' : r.winTeam === 'A' ? '庄家阵营获胜' : '闲家阵营获胜';
  const b5name = v.blackFiveSeat != null && v.players[v.blackFiveSeat] ? esc(v.players[v.blackFiveSeat].name) : '—';
  const btns = v.isHost
    ? '<button class="primary big" data-act="next">下一局</button><button data-act="lobby">返回大厅</button>'
    : '<p class="tip">等待房主开始下一局…</p>';
  return `<div class="overlay"><div class="panel">
    <h2>${win}${r.solo && !r.zeroRound ? '（独庄 ×2）' : ''}</h2>
    <p class="tip" style="text-align:center">本局黑五：${b5name}${r.solo ? '（庄家自持黑桃5，独庄）' : ''}</p>
    <table>
      <thead><tr><th>名次</th><th>玩家</th><th>阵营</th><th>本局</th><th>总分</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="actions">${btns}</div>
  </div></div>`;
}
