// 入口：首页交互 + Cloudflare 房间 WebSocket 装配。
import { createRoom, RoomNet } from './net.js';
import { init as initUI, render, bindSend, toast, setRoomInfo } from './ui.js';

const $ = selector => document.querySelector(selector);
initUI();

const params = new URLSearchParams(location.search);
if (params.get('room')) $('#inp-code').value = params.get('room').toUpperCase().slice(0, 5);
$('#inp-name').value = sessionStorage.getItem('jh5-name') || '';

let roomNet = null;
let currentRoom = null;
let retryCount = 0;

function setSender(fn) {
  bindSend(fn);
}

function showRoom() {
  $('#screen-home').classList.add('hidden');
  $('#screen-room').classList.remove('hidden');
}

function setCreateBusy(busy, label = '创建房间') {
  $('#btn-create').disabled = busy;
  $('#btn-create').textContent = busy ? label : '创建房间';
}

function setJoinBusy(busy, label = '加入房间') {
  $('#btn-join').disabled = busy;
  $('#btn-join').textContent = busy ? label : '加入房间';
}

function resetHomeButtons() {
  setCreateBusy(false);
  setJoinBusy(false);
}

function connectRoom(code, name, token) {
  if (roomNet) roomNet.destroy();
  currentRoom = { code, name, token };

  const net = new RoomNet({
    onWelcome(data) {
      if (roomNet !== net) return;
      retryCount = 0;
      currentRoom.token = data.token;
      sessionStorage.setItem('jh5-token-' + code, data.token);
      setSender(message => {
        if (!net.send(message)) toast('连接尚未恢复，请稍后再试');
      });
      setRoomInfo(code);
      resetHomeButtons();
      showRoom();
    },
    onState(view) {
      if (roomNet === net) render(view);
    },
    onError(message) {
      if (roomNet === net) toast(message);
    },
    onClose({ rejected }) {
      if (roomNet !== net) return;
      if (rejected) {
        resetHomeButtons();
        return;
      }
      if (retryCount >= 3) {
        toast('重连失败，请刷新页面重新加入');
        resetHomeButtons();
        return;
      }
      retryCount++;
      toast(`连接断开，正在重连（${retryCount}/3）…`);
      setTimeout(() => {
        if (roomNet === net && currentRoom) {
          connectRoom(currentRoom.code, currentRoom.name, currentRoom.token);
        }
      }, 1000);
    },
  });
  roomNet = net;
  net.connect(code, name, token);
}

$('#btn-create').addEventListener('click', async () => {
  const name = $('#inp-name').value.trim();
  if (!name) return toast('请先输入昵称');
  sessionStorage.setItem('jh5-name', name);
  setCreateBusy(true, '创建中…');
  try {
    const room = await createRoom(name);
    retryCount = 0;
    connectRoom(room.code, name, room.token);
    toast('正在进入房间…');
  } catch (e) {
    toast(e.message || '创建房间失败');
    setCreateBusy(false);
  }
});

$('#btn-join').addEventListener('click', () => {
  const name = $('#inp-name').value.trim();
  const code = $('#inp-code').value.trim().toUpperCase();
  if (!name) return toast('请先输入昵称');
  if (!/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(code)) {
    return toast('请输入正确的 5 位房间号');
  }
  sessionStorage.setItem('jh5-name', name);
  const token = sessionStorage.getItem('jh5-token-' + code) || null;
  retryCount = 0;
  setJoinBusy(true, '连接中…');
  connectRoom(code, name, token);
  toast('正在连接房间…');
});

$('#btn-leave').addEventListener('click', () => {
  if (confirm('确定要离开房间吗？')) location.href = location.pathname;
});
