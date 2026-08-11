# 挤黑五 · Cloudflare 在线联机

多人在线卡牌游戏“挤黑五”。前端静态资源、HTTP API 和 WebSocket 统一部署到
Cloudflare Workers；每个房间由一个 SQLite-backed Durable Object 承载权威游戏状态。

## 架构

```text
浏览器 ── HTTPS / WebSocket ──> Cloudflare Worker
                                      │
                                      └── Room Durable Object
                                          ├── 玩家连接与断线恢复
                                          ├── 权威规则校验
                                          ├── 个性化状态广播
                                          └── SQLite 状态持久化
```

- 房主关闭浏览器不会导致服务端消失；大厅中房主离开后，下一位玩家自动成为房主。
- 浏览器只发送动作，手牌、回合与计分均由服务端校验。
- 每位玩家只收到自己有权查看的手牌和隐藏身份信息。
- 房间无连接 6 小时后自动清理。
- 房主可在大厅添加或移除服务端人机；一名真人加两名人机即可开始本地验证。
- 支持房间文字聊天、中文快捷语音、牌面点数/牌型播报和麦克风实时语音。
- 实时语音由 Cloudflare Durable Object 转发信令，媒体使用浏览器 WebRTC 和 Cloudflare STUN；不依赖 PeerJS 公共服务器。
- 点击其他玩家头像可发送番茄或水桶，所有客户端同步播放互动动画和音效。
- 每局从本地头像素材库随机分配不重复头像，真人和人机在所有客户端保持一致。
- 牌力从小到大为 `4、6、7、8、9、10、J、Q、K、A、2、3、5`，同牌型的 5 可以压 5。
- 顺子和连对只允许 `4` 到 `A`，最大三张顺子为 `Q-K-A`，`K-A-2` 不成立。
- 庄家不是大落时本局所有玩家记 `0` 分；庄家大落时按名次正常结算。
- 大尺寸中央牌桌将其他玩家分布在边缘，当前一手牌集中显示在桌心。
- 操作音效由 Web Audio 生成；BGM 使用本地免费许可曲目循环播放，可在房间右上角关闭。

## 项目结构

```text
public/                 浏览器静态资源
  index.html
  css/style.css
  audio/
    bassa-island-game-loop.mp3  免费许可循环 BGM
    ATTRIBUTION.md              音乐署名与许可证
  avatars/                      本地 PNG 头像素材与许可说明
  js/
    main.js             页面入口与断线重连
    net.js              Cloudflare WebSocket 客户端
    audio.js            Web Audio 音效、中文播报与 BGM
    voice.js            WebRTC 房间语音
    speech.js           点数与牌型播报文案
    engine.js           权威游戏状态机（Worker 与测试共用）
    rules.js            牌型与比较规则
    cards.js            牌库定义
    ui.js               页面渲染
worker/index.js         Worker 路由与 Room Durable Object
wrangler.jsonc          Cloudflare 配置与 Durable Object 迁移
test.mjs                规则和完整对局测试
docs/cloudflare-deploy.md  注册与部署教程
```

## 本地开发

需要 Node.js 22 或更高版本：

```bash
npm install
npm run dev
```

打开 Wrangler 输出的本地地址，通常是 `http://localhost:8787`。

进入大厅后点击“添加人机”两次即可用一名真人开局。房间右上角的音乐与牌局音效
使用两个独立开关。麦克风权限只能在 HTTPS 或
`localhost` 安全上下文使用；线上 `workers.dev` 地址天然满足 HTTPS 要求。

运行测试和部署前检查：

```bash
npm test
npm run check
```

## 部署

```bash
npx wrangler login
npm run deploy
```

完整的 Cloudflare 免费账户注册、首次发布、验证和自定义域名步骤见
[`docs/cloudflare-deploy.md`](docs/cloudflare-deploy.md)。

## 免费额度说明

本项目使用 Workers Free 的 Workers、Static Assets 和 SQLite-backed Durable Objects。
免费额度会调整，部署前应以 Cloudflare 官方控制台和定价页面为准。小规模朋友联机时，
房间动作量通常远低于免费额度。免费额度耗尽后，免费计划会拒绝后续操作，不会自动扣费。

## 音乐许可

背景音乐使用 Kevin MacLeod 的 **Bassa Island Game Loop**，依据
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) 使用。
完整署名见 [`public/audio/ATTRIBUTION.md`](public/audio/ATTRIBUTION.md)。

头像素材通过 DiceBear 的 **Adventurer** 风格生成，原画作者 Lisa Wischofsky，依据
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) 使用。
完整署名见 [`public/avatars/ATTRIBUTION.md`](public/avatars/ATTRIBUTION.md)。
