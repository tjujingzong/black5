# 音频与实时语音

## 音频系统 (audio.js)

`GameAudio` 统一管理背景音乐、音效与中文播报，并针对移动浏览器做了兼容处理。

### 三套播放通道

1. **Web Audio**：合成点击、出牌、错误等短促音效，并做中文语音合成（`SpeechSynthesis`）。
2. **媒体播放器**：复用 `<audio>` 元素播放内置 WAV 音效与快捷语音，主要服务移动端（移动浏览器对 Web Audio/系统语音限制更严）。
3. **音乐通道**：单独的 `<audio>` 播放 BGM，音量 0.18，三首曲目无重复随机循环（`nextMusic`），出错自动切下一首。

### 媒体预热

移动浏览器要求音频由用户手势触发。`primeMediaPlayers` 在首次交互时用一段静音（`silence.wav`）以极小音量播放，解锁后续自动播放；`effectPlayers` 是 3 个复用的媒体播放器池（`EFFECT_PLAYER_COUNT`），避免每次音效都创建新元素。`voicePlayer` 独立用于快捷/过牌语音。

### 音效与快捷语音资源

- `EFFECT_MEDIA_SOURCES`：click/card/join/ready/play/pass/blackFive/turn/start/result/error/tomato/bucket 等 WAV。
- `VOICE_MEDIA_SOURCES`：三条快捷语音、三条过牌语音、黑五现身、顺子、姊妹对等中文 WAV。

### 事件驱动

服务端视图携带 `audioEvent`（`{id, type, combo?, blackFive?, text?, timeout?}`）。客户端按 `id` 去重，根据 `type` 选择音效/语音：出牌播报牌型（`comboSpeech`）、过牌播报随机 `PASS_PHRASES`、黑五现身特殊音效等。语种按文案判断（`speechLanguage`：`pass` → en-US，其余 zh-CN）。

### 配置持久化

音乐与音效开关分别存于 `localStorage` 的 `jh5-music-enabled` / `jh5-effects-enabled`，并兼容旧键 `jh5-audio-enabled`。首次进入默认开启。

## 实时语音 (voice.js)

采用浏览器 WebRTC mesh，无中心媒体服务器。

### 建立连接

1. `enable()` 调 `getUserMedia` 获取麦克风（开启回声消除/降噪/自动增益），发 `{t:'voiceStatus', enabled:true}`。
2. 服务端广播玩家 `voice` 状态，各端 `syncPeers` 计算需要直连的对端集合（双方都开语音、在线、非人机）。
3. `ensurePeer(id, initiate)`：按 `myId.localeCompare(id) < 0` 决定谁是 offer 方，避免双向都发起。
4. `RTCPeerConnection` 配置公共 STUN 服务器，通过游戏 WebSocket 转发 `offer/answer/ice`（见 [realtime-protocol.md](realtime-protocol.md) 的“语音信令转发”）。
5. 媒体流挂到 `pc`，`ontrack` 播放对端音频；迟到的 ICE 候选缓存到 `pendingIce`，收到对端 answer/SDP 后再注入。

### 状态同步

- `update(view)` 每次收到视图都重新计算对端集合：新加入的建立连接，已离开的 `closePeer`。
- `onDisconnected` 关闭所有 peer，`onConnected` 重新声明自己的语音状态。
- 人机不参与语音，`syncPeers` 过滤 `isBot`。

### 限制

- 必须 HTTPS 或 localhost（`getUserMedia` 安全上下文要求）。
- 极少数严格企业网络或对称 NAT 可能需要 TURN；项目默认不配置付费 TURN。
