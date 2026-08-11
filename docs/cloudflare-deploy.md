# Cloudflare 注册与部署教程

本项目使用 Cloudflare Workers Static Assets、WebSocket 和 SQLite-backed Durable Objects。
Workers Free 可以部署这些能力，不需要先绑定银行卡。

## 一、注册免费账户

1. 打开 <https://dash.cloudflare.com/sign-up>。
2. 输入邮箱和密码创建账户，然后完成邮箱验证。
3. 登录控制台，进入 **Workers & Pages**。
4. 如果首次进入时要求设置 `workers.dev` 子域名，填写一个自己容易识别的名称。
   最终地址通常类似 `https://black5.<你的子域>.workers.dev`。
5. 保持 **Workers Free** 计划，不要选择 Workers Paid，也不需要添加付款方式。

## 二、准备本地环境

安装 Node.js 22 或更高版本。在项目根目录运行：

```powershell
npm install
```

确认项目可以通过检查：

```powershell
npm test
npm run check
```

## 三、授权 Wrangler

在项目根目录执行：

```powershell
npx wrangler login
```

Wrangler 会打开 Cloudflare 授权页面。选择刚注册的账户并允许 Wrangler 管理 Workers。
授权完成后回到终端，执行：

```powershell
npx wrangler whoami
```

能看到 Cloudflare 账户名称和 Account ID 即表示登录成功。

## 四、首次部署

执行：

```powershell
npm run deploy
```

首次部署会自动完成以下操作：

- 上传 `public/` 中的静态页面；
- 发布 `worker/index.js`；
- 创建 `ROOMS` Durable Object 命名空间；
- 执行 `v1` SQLite Durable Object 迁移；
- 分配 `workers.dev` 访问地址。

部署结束时终端会显示网站 URL。以后代码更新后再次运行 `npm run deploy` 即可。

## 五、验证部署

先访问健康检查：

```text
https://你的地址.workers.dev/api/health
```

正常结果：

```json
{"ok":true,"service":"black5"}
```

然后访问网站首页并测试：

1. 普通窗口创建房间。
2. 无痕窗口使用另一昵称加入同一房间。
3. 确认双方玩家列表同步。
4. 凑够至少三名玩家，测试准备、开局、出牌和刷新后重连。

在 Cloudflare 控制台的 **Workers & Pages → black5 → Logs** 中可以查看运行日志。

## 六、绑定自己的域名（推荐但非必需）

如果域名已经接入当前 Cloudflare 账户：

1. 打开 **Workers & Pages → black5 → Settings → Domains & Routes**。
2. 点击 **Add → Custom Domain**。
3. 填写例如 `black5.example.com`。
4. 等待证书状态变为 Active。

前端和 API 是同一个 Worker，无需修改代码或配置 CORS。

中国大陆不同运营商访问 `workers.dev` 的情况可能不同。正式分享前应使用目标电脑和手机网络
测试；自定义域名通常更便于更换访问入口，但不等同于 Cloudflare 中国网络服务。

## 七、常用命令

```powershell
# 本地开发
npm run dev

# 规则测试
npm test

# 只打包检查，不发布
npm run check

# 发布新版本
npm run deploy

# 查看实时日志
npx wrangler tail

# 查看当前登录账户
npx wrangler whoami

# 退出 Wrangler 登录
npx wrangler logout
```

## 八、免费额度与注意事项

- Worker 请求免费额度：每天 100,000 次。
- Durable Object 请求免费额度：每天 100,000 次。
- 入站 WebSocket 消息按 20:1 折算为 Durable Object 请求。
- Durable Object SQLite：每天读取 500 万行、写入 10 万行，总存储 5GB。
- Static Assets 静态资源请求免费且不限量。
- 本项目使用 WebSocket Hibernation，房间空闲时不会持续占用运行时长。
- 免费额度耗尽后请求会失败，不会自动升级或扣款。

额度与产品政策可能变化，应以以下官方页面为准：

- <https://developers.cloudflare.com/workers/platform/pricing/>
- <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>

## 九、语音功能说明

- 房间语音必须在 HTTPS 或 `localhost` 下使用；`workers.dev` 默认提供 HTTPS。
- 第一次点击房间右上角麦克风按钮时，浏览器会请求麦克风权限。
- Cloudflare Durable Object 只负责转发 WebRTC 信令，实际音频在参与者浏览器之间传输。
- STUN 使用 `stun.cloudflare.com:3478`，不依赖 PeerJS。极少数严格企业网络或对称 NAT
  环境可能还需要 TURN；本项目默认不配置付费 TURN 服务。
