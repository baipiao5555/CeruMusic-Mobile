# v2.8.1 正式版

修复音源市场下载被误判，以及澜音账号登录迁移到新的 OIDC 应用。

## 音源市场

- 修正 Ceru v2 / LX 文件被误当作 MusicFree 脚本适配的问题。此前兼容层会按 `.js` 文件名把所有文件改成 `musicfree.custom.*`，导致目录 ID 与文件 ID 不一致，酷狗等音源无法下载。
- 目录缓存落后于仓库文件时，按已校验文件的实际版本继续，并同步修正本地目录缓存；不再要求用户手动刷新后才能安装。
- 下载线路返回的版本低于目录版本时仍会拒绝，避免旧线路缓存覆盖新目录。

## 澜音账号 OIDC

- 切换到新公开客户端 `pwp79ko18ykz9ir6acry7`，发行者为 `https://auth.shiqianjiang.cn/oidc`。
- 登录回调改为 `cerumusic://login/callback`，并登记退出回调 `cerumusic://logout/callback`。
- 授权码交换使用 `/oidc/token`，并通过 `/oidc/me` 补全用户资料；UserInfo 暂时不可用时仍以 ID Token 声明回退。
- 使用 PKCE，申请 `openid profile offline_access ceru:read` 与澜音 API resource。
- 旧客户端会话和待处理登录状态会在升级后清除，避免继续使用旧受众的凭据。

## 验证

- `test-account-session.mjs`、`test-account-cloud.mjs`、`test-auth-callback-ui.mjs`、`test-market-core.mjs`、`test-market-stale-catalog.mjs` 通过。
- 实际仓库酷狗文件解析为 `ceru.kugou v2.0.1`，旧目录缓存 v1.0.0 → 文件 v1.1.0 的受控页面测试可正常进入安装确认。
- 新 OIDC 客户端授权地址可进入登录页；Token 端点和 UserInfo 端点已按新发行者配置。
- Web 构建、Capacitor sync、Android Release 构建通过。
- 未使用真实澜音账号完成授权码回跳；真机登录、退出回调与云歌单读取仍需安装后复测。
