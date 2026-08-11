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
- 彻底移除 PeerJS/WebRTC 依赖；当前版本不提供实时语音。
- 牌力从小到大为 `4、6、7、8、9、10、J、Q、K、A、2、3、5`，同牌型的 5 可以压 5。
- 大尺寸中央牌桌将其他玩家分布在边缘，当前一手牌集中显示在桌心。
- 内置浏览器合成的操作音效和低音量循环 BGM，可在房间右上角随时关闭。

## 项目结构

```text
public/                 浏览器静态资源
  index.html
  css/style.css
  js/
    main.js             页面入口与断线重连
    net.js              Cloudflare WebSocket 客户端
    audio.js            Web Audio 音效与 BGM
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
