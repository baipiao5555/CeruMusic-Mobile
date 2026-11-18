# 澜音 v2.6.27 · 移除内置平台登录，只保留澜音账号

本版按产品范围收缩账号体系：删除 QQ 音乐、网易云音乐、酷狗、酷我、咪咕、汽水的内置网页登录与平台歌单导入，只保留澜音账号登录和澜音云端歌单。

## 账号与入口

- 删除「登录音乐平台」Sheet、平台账号状态、平台歌单目录和公开链接导入界面。
- 删除 Android 原生 `PlatformLogin` 插件及其 WebView 登录布局、JS/CSS 资源。
- 「我的」页头像区域改为直接打开澜音云端歌单；未登录时明确显示「点击登录澜音」。
- 设置页只保留澜音账号登录/退出，不再显示「音乐平台登录」。
- 旧 `/accounts` 路由统一跳转到 `/cloud`。
- 首次启动会一次性清理旧版本保存在 Keystore 中的 `music.platform.*` 平台会话；之后不再读写这些凭据。

## 保留能力

- 澜音 OAuth 登录、云端歌单目录读取、单歌单/全部导入和导入前确认。
- 音源插件自己的账号界面和插件导入器保持独立；本次只移除内置平台网页登录，不影响澜音账号、音源插件或插件提供的歌单导入。
- WebDAV 双向同步、删除记录、WebDAV 音乐库、应用级自动同步、平板布局和最新交互动效均保留。

## 验证

- `node scripts/test-lanyin-only.mjs`：21/21 通过，检查平台登录文件/原生插件已移除，「我的」和设置页只保留澜音入口，旧 `/accounts` 跳转到 `/cloud`。
- `node scripts/test-sync-two-way.mjs`：133/133 通过。
- `node scripts/test-sync-webdav.mjs`：47/47 通过。
- `node scripts/test-webdav-media.mjs`：64/64 通过。
- `node scripts/test-auto-sync.mjs`：13/13 通过。
- `node scripts/test-account-cloud.mjs`：33 项通过；`node scripts/test-account-session.mjs`：8 项通过。
- `node scripts/test-sync-ui.mjs`：24/24 通过；`node scripts/test-tablet-layout.mjs`：287/287 通过。
- 搜索入口、Sheet 动效、搜索联想和 UI 竞态测试通过；`vue-tsc`、Web 构建、Android `assembleRelease` 通过。

versionName 2.6.27，versionCode 24045；保留原签名。没有 Android 真机、真实澜音账号或真实 NAS 验证；澜音登录回调、Keystore 旧会话清理、后台保活和 WebDAV 媒体播放仍需实机确认。

APK SHA-256：9009f8d473562cb31bc4e7dddf42b6f2ea9502d07fdd026f4704ee5833ed160a

APK 大小：7568293 字节
