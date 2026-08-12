# 前端与渲染 (public/js, public/css)

前端为原生 ES Module，无构建步骤，直接由 Static Assets 提供。

## 模块职责

| 文件 | 职责 |
| --- | --- |
| `main.js` | 页面入口、首页交互、连接装配与断线重连 |
| `net.js` | `createRoom` + `RoomNet`（WebSocket 客户端） |
| `ui.js` | 由服务端视图驱动的纯渲染 |
| `engine.js` | 权威状态机（与 Worker 共用，见 [engine.md](engine.md)） |
| `rules.js` | 牌型判定/比较/提示 |
| `cards.js` | 牌库、洗牌、排序、点数显示 |
| `audio.js` | Web Audio 音效、中文播报、BGM |
| `voice.js` | 实时语音（WebRTC mesh） |
| `speech.js` | 牌型播报文案与语种 |

`ui.js` 完全由 `view` 驱动：每次收到 `{t:'state', view}` 调用 `render(v)` 重建 DOM，选中态、聊天草稿、焦点等本地状态在重建间保留。

## 手牌分组叠放

手牌按点数分组（`groupedHand`），同点数的牌在一个 `.card-group` 内纵向叠放，减少横向占用并放大单张牌面。

- 每个 `.card` 设 `--card-index`，所在组设 `--group-size`，`.hand` 设 `--stack-offset`。
- **叠放方向**：第 0 张在底部且在最前，后续牌向**上方**叠放且在**前一张的下一层**（更靠后），使每张牌的左上角（点数 + 花色）都能露出。
- 公式：
  - `top: calc((var(--group-size) - 1 - var(--card-index)) * var(--stack-offset))`
  - `z-index: calc(var(--group-size) - var(--card-index))`
- 组高 `calc(100px + (var(--group-size) - 1) * var(--stack-offset))`，桌面 50px / 移动端 44px。
- 选中态 `.sel` 提到 `z-index:10` 并上移，悬停轻微上移。
- `.hand` 用 `align-items: flex-end` 让各组底部对齐，像立于桌面。

以 3 张同点数（offset 50）为例：card0 `top=100,z=3`（底/前），card1 `top=50,z=2`，card2 `top=0,z=1`（顶/后）。card1 在 card0 上方露出 50px，正好显示点数（top 6–25）与花色顶部（top 34–50）。

## 桌面牌桌与座位

- `.table-felt` 为大尺寸中央牌桌，其他玩家分布边缘，当前一手牌集中显示在桌心 `.table-center`。
- 对手座位根据人数映射到不同位置类（`seat-top` / `seat-left` / `seat-right` / `seat-*-high/low`），`positions` 表覆盖 1–5 名对手。
- 桌心 `center`：有 `pending` 时显示出牌者与牌型名 + `table-cards`；否则提示等待/首出。
- 每位玩家 chip 显示头像、张数/名次、最后动作（出牌牌面缩略或过牌语音），当前轮次高亮。

## 响应式

- `>900px`：桌面布局，聊天与日志双栏。
- `≤900px`：聊天与日志改为单栏。
- `≤560px`：手机布局。牌桌高度用 `clamp(340px,49svh,410px)`，座位、头像、字号、手牌（62×88、`--stack-offset:44px`）均缩小，工具栏与控制按钮适配触屏。

## 交互与道具

点击其他玩家头像选中为 `socialTarget`，弹出 `.prop-menu`（番茄/水桶）。发送后服务端记录 `lastInteraction` 并广播，所有客户端同步播放飞行动画（`.prop-flight`）与落点动画（`.prop-impact`）。

## 状态条与倒计时

`.game-statusbar` 显示局数、庄家、当前轮次。`.turn-clock` 根据视图的 `turnDeadline` 与本地时钟（按 `serverNow` 校准 `serverClockOffset`）渲染剩余秒数，每 250ms 刷新（`updateTurnClocks`），临近超时脉冲放大。
