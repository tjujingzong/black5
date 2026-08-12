# 实时连接协议

客户端通过同源 WebSocket 与房间 Durable Object 通信。HTTP 仅用于创建房间，WebSocket 承载所有后续交互。

## 建立连接

1. `POST /api/rooms` `{name}` → `{code, token}`（`net.js createRoom`）。
2. `WebSocket /api/rooms/{CODE}/ws`，协议随页面 `https→wss` / `http→ws`。
3. 连接打开后立即发送 `{t:'join', name, token}`。
4. 服务端 `joinSocket` 校验后回 `{t:'welcome', id, token}`，`id` 即玩家 token。此后玩家身份由服务端 `ws.serializeAttachment({playerId})` 绑定，客户端不需要每条消息都带 token。
5. 之后服务端持续下发 `{t:'state', view}` 推送个性化视图。

## 客户端 → 服务端 (net.js send)

| t | 字段 | 说明 |
| --- | --- | --- |
| `join` | name, token | 首次加入/断线重连 |
| `ready` | ready:boolean | 准备/取消 |
| `start` | | 房主开局 |
| `play` | ids:string[] | 出牌（手牌 id） |
| `pass` | | 过牌 |
| `reveal` | | 黑五明牌 |
| `next` / `toLobby` | | 房主：下一局/回大厅 |
| `addBot` / `removeBot` | id? | 房主：加/移人机 |
| `chat` | text | 文字聊天（≤80 字符） |
| `quick` | text | 快捷语音（必须命中 `QUICK_PHRASES`） |
| `voiceStatus` | enabled:boolean | 麦克风开关 |
| `interact` | to, item | 道具互动（tomato/bucket） |
| `voiceSignal` | to, kind, data | WebRTC 信令转发（offer/answer/ice） |

消息上限 16KB，超长或非 JSON 以 4002 拒绝。

## 服务端 → 客户端

| t | 内容 |
| --- | --- |
| `welcome` | `{id, token}` 加入成功 |
| `state` | `{view}` 完整个性化视图（见 [engine.md](engine.md)） |
| `voiceSignal` | `{from, kind, data}` 转发的对端 WebRTC 信令 |
| `err` | `{msg}` 错误提示 |

## 断线重连

- 客户端 `RoomNet` 维护 `joined`/`rejected` 状态。连接关闭时若非 `manualClose`，回调 `onClose({joined, rejected})`，由 `main.js` 决定重连策略。
- 重连时带原 `token`，服务端 `join` 找回原座位，`connected=true`，下发“重新连接”日志。
- 若同一玩家已有旧连接，服务端以 4000 `replaced` 关闭旧连接（多标签场景）。
- 对局中全员掉线时服务端 `pauseTurnTimer`，重连后恢复，避免无人时超时失效。
- 连接超时 15s（`CONNECT_TIMEOUT`），未收到 `welcome` 则报错并关闭。

## 语音信令转发

WebRTC 信令不走单独服务器，复用游戏 WebSocket：

- 客户端发 `{t:'voiceSignal', to:对端publicId, kind:'offer'|'answer'|'ice', data}`；
- 服务端 `forwardVoiceSignal` 校验双方都开启了 `voice`、`kind` 合法、`data` 非空，再按 `to` 的 `publicId` 查找玩家及其连接转发 `{t:'voiceSignal', from, kind, data}`；
- 媒体本身在浏览器之间点对点传输，服务端只转信令。

## 房间号与路由

- 房间号 5 位，字符集去除 I/O/0/1 等易混字符。
- `env.ROOMS.idFromName(code)` 保证同号同实例，房主离线房间不消失。
- `/api/rooms/{CODE}/ws` 校验房间号格式后转发请求给对应 `Room`。
