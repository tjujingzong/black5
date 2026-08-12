# 权威状态机 (public/js/engine.js)

`Game` 类是房间的权威游戏状态机，被 Worker (`worker/index.js`) 和 Node 测试 (`test.mjs`) 共用，保证线上与离线规则一致。

## 字段速览

| 字段 | 含义 |
| --- | --- |
| `players` | 座位数组，下标即座位，对局中不变 |
| `phase` | `lobby` / `playing` / `roundEnd` |
| `dealer` / `turn` | 庄家座位 / 当前行动座位 |
| `pending` | 待压的牌 `{seat, combo, cards}` |
| `passStreak` | 本圈连续过牌数 |
| `rankCount` | 已出完人数 |
| `winTeam` | `'A'` 庄家阵营 / `'B'` 闲家阵营 |
| `blackFiveSeat` / `blackFivePublic` / `solo` | 黑五身份相关 |
| `lastActions` | 本圈每位玩家最后动作（桌面展示用） |
| `result` | 结算结果 |
| `log` / `chat` | 日志与聊天（分别保留 60 / 40 条） |
| `turnStartedAt` / `turnDeadline` | 回合计时（基于服务端时间） |

## 生命周期

```text
lobby ──start──> playing ──finishRound──> roundEnd ──next──> playing（下一局）
                                    └──toLobby──> lobby（积分清零）
```

- `start`：仅房主可调用，首局随机庄家，之后每局 `dealer = (dealer+1)%n` 轮替。
- `startRound`：洗牌、轮发、排序、定位黑五、判定独庄、重置 `pending`/`passStreak`/`lastActions`、庄家首出、`resetTurnTimer`。
- `finishRound`：补齐最后一名、计算阵营总分、生成 `result.rows`、暂停计时、进入 `roundEnd`、公开黑五身份。
- `next` / `toLobby`：仅房主可调用。

## 消息分发 (handleMsg)

`handleMsg(id, msg)` 按客户端 `t` 字段分发：

| t | 方法 | 说明 |
| --- | --- | --- |
| `ready` | setReady | 大厅准备 |
| `start` | start | 开局 |
| `play` | play | 出牌（ids） |
| `pass` | pass | 过牌 |
| `reveal` | reveal | 黑五明牌 |
| `next` / `toLobby` | next/toLobby | 房主控制 |
| `addBot` / `removeBot` | | 房主管理人机 |
| `chat` / `quick` | sendChat | 文字/快捷语音 |
| `voiceStatus` | setVoiceStatus | 开关麦克风 |
| `interact` | interact | 道具互动（番茄/水桶），700ms 限频 |

所有方法返回字符串即错误，返回 `null` 即成功。

## 出牌流程

`play(id, ids, timeout)`：

1. 校验阶段、是否轮到、选牌不重复且有效；
2. `classify` 判定牌型，不合法报错；
3. 若有 `pending` 且非本人首出，`canBeat` 校验能否压过；
4. 从手牌移除、设 `pending`、清 `passStreak`、记 `lastActions` 与 `lastAudioEvent`；
5. 若打出黑桃5 → `blackFivePublic = true`；
6. 若手牌清空 → `outSeat`（记录名次、头科判胜负）；
7. `afterAction` 推进回合。

`afterAction`：

- 剩余 ≤1 人 → `finishRound`；
- 若 `passStreak >= active-1`（除最后出牌者外全过牌）→ `endTrick`；
- 否则 `turn = nextActive(turn)` 并 `resetTurnTimer`。

`endTrick`：清 `pending`/`passStreak`/`lastActions`，出牌权交回最后出牌者（或其下家，若已出完）。

## 回合计时（与服务端对齐）

- `resetTurnTimer(now)`：`turnDeadline = now + 20s`，`now` 取服务端 `Date.now()`。
- `pauseTurnTimer`：清空两个时间戳。
- `turnExpired(now)` / `timeoutTurn(now)`：超时判定与处理。`timeoutTurn` 在 Worker 每次消息和闹钟触发时被调用，保证权威。
- 视图下发 `serverNow` / `turnStartedAt` / `turnDeadline` / `turnSeconds`，客户端据此渲染本地倒计时并周期校准（`updateTurnClocks` 每 250ms 刷新）。

## 人机 (actBot)

`actBot` 复用 `findHint`：能压则出 `findHint` 推荐的牌，否则过牌。Worker 中 `runBots` 以 650ms 间隔循环驱动，直到轮到真人或对局结束。

## 状态视图与战争迷雾 (viewFor)

`viewFor(id)` 生成面向某玩家的视图，关键裁剪：

- `myHand`：仅自己的手牌；
- `mySecret`：仅黑五持有者收到 `{solo, dealer}`，告知自己是独庄还是庄家队友；
- `canReveal`：仅黑五本人且未公开时为 true；
- `isBlackFive` / `blackFiveSeat`：仅 `blackFivePublic` 后才暴露；
- `pending.cards`：已打出的牌对所有人可见（在桌心）；
- 其余玩家只暴露 `count`（张数）、`outRank`、`connected`、`voice` 等公开信息。

聊天与日志做截断（聊天 30 条、日志 9 条）后下发，控制消息体积。`serverNow` 用于客户端校准本地时钟偏差。

## 持久化兼容 (normalize)

`restoreGame` 用 `Object.assign` 还原字段后调用 `normalize`，补齐历史版本可能缺失的 `chat`/`messageSeq`/`interactionSeq`/`audioSeq` 等字段，并在缺头像或头像重复时重新分配，保证向前兼容。这也是房间能跨部署版本存活的依据。
