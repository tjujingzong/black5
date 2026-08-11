// 入口：首页交互 + 房主/客人两种模式的装配
import { Game } from './engine.js';
import { HostNet, GuestNet, describePeerError } from './net.js';
import { VoiceManager } from './voice.js';
import { init as initUI, render, bindSend, toast, setRoomInfo } from './ui.js';

const $ = s => document.querySelector(s);
initUI();

// 从 URL 预填房间号（邀请链接 ?room=XXXXX）
const params = new URLSearchParams(location.search);
if (params.get('room')) $('#inp-code').value = params.get('room').toUpperCase().slice(0, 5);
$('#inp-name').value = sessionStorage.getItem('jh5-name') || '';

let myId = null;
let engine = null, hostNet = null;   // 房主模式
let guestNet = null, guestJoined = false, guestRetry = 0; // 客人模式

const voice = new VoiceManager();
let lastView = null;
let sendFn = () => {}; // 发送动作的统一入口（同时同步给 ui 层）
function setSender(fn) { sendFn = fn; bindSend(fn); }

// 从最新视图构造语音成员名单（除自己外、在线且有 Peer ID 的玩家）
function buildRoster(view) {
  if (!view) return [];
  return view.players
    .filter(p => !p.isMe && p.connected && p.peerId)
    .map(p => ({ playerId: p.id, peerId: p.peerId }));
}

function afterRender(view) {
  lastView = view;
  voice.setRoster(buildRoster(view));
}

function updateVoiceBtn() {
  $('#btn-voice').textContent = voice.enabled ? '🔇 关语音' : '🎤 开语音';
}

$('#btn-voice').addEventListener('click', async () => {
  if (voice.enabled) {
    voice.disable();
    sendFn({ t: 'voice', on: false });
    updateVoiceBtn();
    toast('语音已关闭');
    return;
  }
  if (!myId) return toast('尚未进入房间');
  try {
    await voice.enable(myId, buildRoster(lastView));
    sendFn({ t: 'voice', on: true });
    toast('语音已开启，与其他开语音的玩家点对点通话');
  } catch (e) {
    toast('无法访问麦克风，请检查浏览器权限（需 HTTPS 或 localhost）');
  }
  updateVoiceBtn();
});

function showRoom() {
  $('#screen-home').classList.add('hidden');
  $('#screen-room').classList.remove('hidden');
}

/* ---------------- 创建房间（房主 = 服务器） ---------------- */

function refreshHost() {
  hostNet.broadcast();
  const view = engine.viewFor(myId);
  render(view);
  afterRender(view);
}

$('#btn-create').addEventListener('click', () => {
  const name = $('#inp-name').value.trim();
  if (!name) return toast('请先输入昵称');
  if (typeof Peer === 'undefined') return toast('PeerJS 未加载，请检查网络后刷新');
  sessionStorage.setItem('jh5-name', name);

  engine = new Game();
  myId = engine.join(name).player.id; // 房主自己占第一个座位
  setSender(msg => {
    const err = engine.handleMsg(myId, msg);
    if (err) toast(err);
    refreshHost();
  });

  hostNet = new HostNet(engine, refreshHost);
  $('#btn-create').disabled = true;
  $('#btn-create').textContent = '创建中…';
  hostNet.create(code => {
    setRoomInfo(code);
    showRoom();
    refreshHost();
  }, err => {
    toast('创建房间失败：' + describePeerError(err));
    $('#btn-create').disabled = false;
    $('#btn-create').textContent = '创建房间';
  });
  voice.attach(hostNet.peer); // 语音呼入监听
});

/* ---------------- 加入房间（客人） ---------------- */

$('#btn-join').addEventListener('click', () => {
  const name = $('#inp-name').value.trim();
  const code = $('#inp-code').value.trim().toUpperCase();
  if (!name) return toast('请先输入昵称');
  if (code.length < 4) return toast('请输入房间号');
  if (typeof Peer === 'undefined') return toast('PeerJS 未加载，请检查网络后刷新');
  sessionStorage.setItem('jh5-name', name);
  guestJoined = false;
  guestRetry = 0;
  startGuest(code, name);
});

function startGuest(code, name) {
  if (guestNet) guestNet.destroy();
  const key = 'jh5-token-' + code;
  const token = sessionStorage.getItem(key) || null; // 断线重连凭证
  guestNet = new GuestNet({
    onWelcome(d) {
      myId = d.id;
      guestJoined = true;
      guestRetry = 0;
      sessionStorage.setItem(key, d.token);
      setSender(m => guestNet.send(m));
      setRoomInfo(code);
      showRoom();
    },
    onState(view) { render(view); afterRender(view); },
    onError(msg) { toast(msg); },
    onClose() {
      if (!guestJoined) return;
      if (guestRetry < 3) {
        guestRetry++;
        toast(`连接断开，正在重连（${guestRetry}/3）…`);
        setTimeout(() => startGuest(code, name), 800);
      } else toast('重连失败，请刷新页面重新加入');
    },
  });
  guestNet.join(code, name, token);
  toast('正在连接房间…');
  voice.attach(guestNet.peer); // 重连后是新 Peer，需重新监听呼入
}

/* ---------------- 离开 ---------------- */

$('#btn-leave').addEventListener('click', () => {
  if (confirm('确定要离开房间吗？')) location.href = location.pathname;
});
