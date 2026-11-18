# 澜音 v2.6.29 · 歌词时钟与音源导入修正

本版修正播放器歌词时钟、倍速同步和全屏歌词显示，并对青听音源 JSON 配置给出明确导入说明。

## 修复

- 播放器时钟改用单调本地时钟推进，`timeupdate` 不再每 250ms 把时间回写造成歌词锯齿；倍速按 `playbackRate` 推进。
- 新建音频源后重新应用播放速度，避免 WebView 在切换 source 时把倍速重置为 1。
- 播放器两行歌词预览不再整块重挂载，切换歌词行不再出现“加载一下、跳一下”的效果。
- 全屏歌词只让当前行保持清晰，其他行模糊并降低透明度。
- 识别青听等第三方音源的 JSON 配置并给出明确错误，不再显示泛化的“安装失败”。

## 兼容性

- 平板布局和此前 v2.6.28 的旧 WebView CSS 回退保留。
- 未重新引入内置平台登录；继续使用澜音账号和 WebDAV。

## 验证

- `node scripts/test-lyric-clock.mjs`：2 倍速约 2.00x、时钟不回退、歌词行推进、预览不重挂载、沉浸式模糊规则通过。
- `node scripts/test-plugin-import.mjs`：第三方 JSON 配置被明确拒绝。
- 搜索入口、弹层、播放器封面、长列表回归通过。
- 未做 Android 真机音频和旧 WebView 矩阵。

## 发布产物

- APK：`D:\LX\CeruMusic-Mobile-v2.6.29.apk`
- 大小：`7568492` 字节
- SHA256：`044c44fa242bcffa74a82ba637e2c9dccbc69216e56ef3e2a5d70d6cf55e8264`

versionName 2.6.29，versionCode 24047；继续保留原签名。

