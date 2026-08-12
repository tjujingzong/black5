# 运行架构

本项目是一个单 Worker 多房间的实时卡牌服务。前端静态资源、HTTP 接口和实时连接都由同一个 Worker 承载，每个房间是一个独立的 Durable Object。

## 总体数据流

```text
浏览器 ── HTTPS / WebSocket ──> Worker (fetch)
                                    │
        /api/rooms  ─────────────────┤ 创建房间 → ROOMS.idFromName(code) → Room.create
        /api/rooms/{code}/ws ────────┤ 升级 WebSocket → state.acceptWebSocket → Room
        其他路径 ────────────────────┤ env.ASSETS.fetch → public/ 静态资源
```

`wrangler.jsonc` 中 `assets.run_worker_first: ["/api/*"]` 保证 `/api/*` 请求先进入 Worker，其余由 Static Assets 直接返回静态文件，前后端同源，无需额外 CORS 配置。

## Worker 路由 (worker/index.js default.fetch)

| 路径 | 方法 | 作用 |
| --- | --- | --- |
| `/api/health` | GET | 健康检查，返回 `{"ok":true,"service":"black5"}` |
| `/api/rooms` | POST | 创建房间。重试 8 次生成不冲突的 5 位房间号，调用 `Room.create`，返回 `{code, token}` |
| `/api/rooms/{CODE}/ws` | GET | WebSocket 升级端点。校验房间号后把请求转发给对应 `Room` 实例 |
| `/api/*` 其他 | * | 返回 404 |
| 其他 | * | 交给 `env.ASSETS` 提供静态资源 |

房间号字符集 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（去除易混字符 I/O/0/1），长度 5，用 `crypto.getRandomValues` 生成。

## Room Durable Object (worker/index.js Room)

每个房间号通过 `env.ROOMS.idFromName(code)` 映射到一个 `Room` 实例。同一个房间号永远路由到同一个实例，因此房主关闭浏览器后房间依然存在。

### 构造与恢复

`constructor` 在 `blockConcurrencyWhile` 中从 `state.storage` 读取保存的 `game` 与 `expiresAt`，调用 `restoreGame` 重建 `Game` 状态机。`Game.normalize` 补齐旧版本缺字段、重新分配头像、必要时重置回合计时器，保证持久化数据向前兼容。

### WebSocket Hibernation

`Room` 使用 `state.acceptWebSocket(server)` 让连接进入 Hibernation 模式：

- 空闲时连接被挂起，不计入持续运行时长；
- 收到消息时通过 `webSocketMessage(ws, message)` 唤醒处理；
- 关闭/出错通过 `webSocketClose` / `webSocketError` 处理。

每条连接用 `ws.serializeAttachment({ playerId })` 绑定玩家身份，处理消息时用 `deserializeAttachment` 取回。

### 消息处理顺序

`webSocketMessage` 的处理顺序很关键：

1. 校验消息为字符串且 ≤ 16KB，否则以 4002 拒绝；
2. JSON 解析；
3. 若尚未绑定 `playerId` → 进入 `joinSocket`（首次加入或断线重连）；
4. 若是 `voiceSignal` → 转发 WebRTC 信令（不参与游戏逻辑）；
5. **先调用 `game.timeoutTurn()`**：在任何玩家动作之前推进超时回合，保证倒计时权威；
6. 调用 `game.handleMsg` 执行玩家动作，出错回 `err`；
7. `persist()` 持久化 + `broadcast()` 广播 + `runBots()` 驱动人机。

### 广播与战争迷雾

`broadcast` 对每条在线连接调用 `game.viewFor(playerId)` 生成个性化视图，只暴露该玩家应见的信息（手牌、黑五身份、可明牌标志等都按玩家裁剪，详见 [engine.md](engine.md) 的“状态视图”）。

### 断线与替换

`disconnectSocket` 检查是否还有同一 `playerId` 的其他在线连接（多标签/重连场景）。若有，则不标记掉线；否则调用 `game.handleDisconnect`。对局中若全员掉线，`pauseTurnTimer` 暂停倒计时，避免无人时超时失效。

加入时若发现同一玩家已有旧连接，会以 4000 `replaced` 关闭旧连接，实现“挤下线”。

### 持久化与闹钟

`persist()` 写入 `game` 和 `expiresAt`，并通过 `scheduleAlarm` 设定下一次闹钟。`scheduleAlarm` 选取“回合截止”和“房间过期”中较早的一个：

- 对局中且有连接 → 下次闹钟 = `min(turnDeadline, expiresAt)`，用于权威超时；
- 否则 → 下次闹钟 = `expiresAt`，用于过期清理。

`alarm()` 唤醒时：若有连接且回合已超时 → 推进超时；若无连接且已过期 → `deleteAll` 清理房间。房间默认 6 小时无活动过期（`ROOM_TTL_MS`）。

### 人机驱动

`runBots` 在每次状态变更后循环：若当前轮到人机，等待 650ms 后调用 `game.actBot`（复用 `findHint` 出牌或过牌），直到轮到真人或对局结束。`botRunning` 标志防止重入。

## 关键常量

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `ROOM_TTL_MS` | 6h | 房间无活动过期时间 |
| `MAX_MESSAGE_LENGTH` | 16KB | 单条 WebSocket 消息上限 |
| `BOT_DELAY_MS` | 650ms | 人机出牌间隔 |
| `CODE_LENGTH` | 5 | 房间号长度 |
