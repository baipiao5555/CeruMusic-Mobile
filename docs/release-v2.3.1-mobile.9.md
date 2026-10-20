# 澜音 · CeruMusic 手机版 v2.3.1-mobile.9

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.9

## 修复：浅色状态栏 + 深色图标（真正的原因）

问题不是配色，而是时序：Capacitor 在 Android 上如果**闪屏还没隐藏就调用 `StatusBar.setStyle`，这次调用会被系统丢弃**，之后状态栏一直保持默认的白色图标，于是浅色背景上出现“白字白图标”。

这一版的处理：

- 状态栏恢复浅色 `#EEF7F3`，和页面背景一致
- 浅色主题下图标改为深色，深色主题/播放页仍为浅色图标
- 先设置背景色，再设置图标样式
- 闪屏隐藏后延迟重试：0 / 350 / 900 / 1800 / 3000ms 各同步一次
- App 从后台回到前台时再次同步，避免系统重置

## 其他

- 设置页版本号改为读取真实构建版本，不再写死 `2.3.1-mobile.5`

## 继续包含

- 底部播放任务栏：实色贴底、顶部进度线、绿色圆形播放按钮
- 云歌词匹配：LrcLib + QQ 音乐，支持翻译与自动回退
- 底部 4 Tab、独立歌单页、歌单导入
- VPN/代理 fake-IP 下的插件链接导入
- 插件音质列表与「自动（最高）/超清母带」
- Android 前台媒体服务、歌词、收藏、播放历史

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.9.apk`
- 大小：5.15 MB
- 包名：`com.ceru.music.mobile`
- versionCode：`23109`
- 最低系统：Android 6.0（API 23）
- SHA-256：`2b4f1e184d3b044812b7223bc1f26e3889af3c537c2be37a776e5c81d1205d9a`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
