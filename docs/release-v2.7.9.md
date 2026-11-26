# v2.7.9 正式版

修复 ColorOS 13 登录回跳，并增强同时播放/后台 WebView 保持。

## 登录回跳

- Android 改用应用内 OAuth 登录页，不再依赖系统浏览器把 `cerumusic://oauth/callback` 交回应用。
- 登录页直接捕获回调 URL，完成 PKCE code exchange 后关闭并刷新账号状态。
- 旧版本/异常环境仍保留系统浏览器回退；原有 `appUrlOpen`/冷启动深链处理不变。
- 登录回调、拒绝登录、重复回调、会话切换等现有测试全部通过。

## 同时播放与后台

- 默认开启“与其他应用同时播放”。
- 混音开启时不申请独占焦点；关闭时才申请。
- 焦点申请失败、刚开始播放的短暂焦点丢失不会自动暂停；稳定期后真实失去焦点才暂停。
- WebView 渲染进程设置为 IMPORTANT 优先级，降低 ColorOS 等系统在切换到其他应用后冻结音频的概率。
- 部分应用会强制抢占音频焦点或限制后台 WebView，仍可能中断；这需要真机继续验证。

## 保留

- MusicFree 插件直链、GitHub 页面链接、订阅 JSON 导入。
- MusicFree 搜索、榜单、推荐歌单、歌单详情和歌单导入。
- A 方案音源市场、B 管理界面、本地扫描快照和 WebView 白屏恢复。

## 验证

- `test-auth-callback-ui.mjs`、`test-account-session.mjs`、`test-audio-focus-contract.mjs` 通过。
- Web 构建、Capacitor sync、Android Release 构建通过。
- APK 版本 `2.7.9 / 24082`，同签名；包内 Web 文件与 dist 一致。
- 未连接实体 Android 设备；ColorOS 真机登录和双应用同时播放仍需用户复测。
