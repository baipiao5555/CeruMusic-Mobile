# 澜音 v2.7.2 · 播放、本机搜索与点击修复

基于 v2.7.1 页面动效修复，继续处理播放和本地内容问题。

## 修复

- 播放页手动选择音质后不再显示回「自动」；所选档位会继续传给音源插件并保存到设置。
- 本机音乐进入全局搜索的本地索引：已授权时搜索页会读取 MediaStore，本地歌曲可与在线结果同时显示；本机音乐页扫描后也会更新索引。
- 一次触摸若被部分 WebView 重复派发 `click`，只执行第一次；真实的第二次触摸仍正常生效。
- 本地播放缓存代理请求失败时，自动改用音源返回的原始音频地址，避免缓存代理异常导致所有在线音源都不能播。
- 换歌时清掉上一首遗留的解析音质/错误状态。

## 回归测试

- `test-v270-bugfixes.mjs`：本机搜索、缓存 500 直连回退、手动音质、重复点击、单次切歌全部通过。
- `test-search-suggestions.mjs`、`test-ui-races.mjs` 通过。
- `test-search-entry-motion.mjs`、`test-tab-motion.mjs`、`test-player-morph.mjs`、`test-list-window.mjs` 通过。
- `test-lx-plugin.mjs`、`test-lx-quality.mjs`、`test-lx-catalog.mjs`、`test-network-policy.mjs` 通过。
- `test-plugin-autoupdate-local.mjs`：12/12 通过。
- `test-player-artwork.mjs`：360×640、390×844、1440×900 与 LX 搜索播放流通过。
- `npm run build` 包含 `vue-tsc --noEmit`，通过后构建 Android 包。

## 限制

- 本机没有已连接 Android 设备；模拟器因缺硬件加速无法启动。原生 MediaStore 与缓存代理由模拟桥接和 JVM/静态检查覆盖，仍需安装到手机复测。

## 发布产物

- APK：`D:\LX\CeruMusic-Mobile-v2.7.2.apk`
- 大小：`7554484` 字节
- SHA256：`50d2652e945576994c605505f508802e0b67154738a492c3bea8821f9095dffb`

versionName 2.7.2，versionCode 24052；签名证书与旧版本一致，可覆盖安装。
