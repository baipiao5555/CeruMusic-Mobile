# 澜音 · CeruMusic 手机版 v2.3.1-mobile.32

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.32

这一版根据反馈修正歌单详情页布局。

## 修正内容

- **顶部导航固定**：长歌单向上滚动后，返回按钮、歌单名、重命名/删除不会再一起滚走
- 固定顶栏直接显示当前歌单名称，滚动时也知道自己在哪个歌单
- 顶栏改为不透明背景，避免歌曲封面从导航栏后面透出来
- 歌单封面卡片从 122px 缩小到 100px，减少首屏占用，让歌曲列表更早出现
- 播放全部 / 下载 / 选择按钮同步收紧间距
- 批量选择、底部操作栏保持不变

## 验证

- 30 首歌单滚动 700px 后，顶栏仍固定在页面顶部，返回和操作按钮可见
- 顶栏显示「我喜欢的歌（导入）」等长歌单名时自动省略，不挤压操作按钮
- 390px 手机宽度下封面卡片、按钮和列表无溢出
- `vue-tsc` 类型检查、生产构建通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.32.apk`
- 大小：5675167 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23132`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`44495c8526e86ee7049ff712109130b79b0a727453f4821a80ed41c972e41777`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
