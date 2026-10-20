# 澜音 · CeruMusic 手机版 v2.3.1-mobile.7

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.7

## 修复：状态栏图标看不清

- 修正 Android 状态栏亮暗样式映射：浅色主题使用深色时间和图标，深色主题/播放页使用浅色图标
- 之前浅色主题下状态栏背景是浅色、图标却也是白色，导致时间、电量、信号几乎看不见
- 状态栏背景仍会随主题切换：浅色 `#EEF7F3`，深色/播放页 `#0B1210`

## 继续包含：底部播放任务栏

- 实色底栏，紧贴底部导航，不再半透明透出榜单封面
- 顶部播放进度线、绿色圆形播放/暂停按钮
- 点击封面或歌曲信息进入播放页
- 页面底部留白按播放条是否显示动态调整

## 仍然包含

- 云歌词匹配：LrcLib + QQ 音乐，支持翻译与自动回退
- 底部 4 Tab、独立歌单页、歌单导入
- VPN/代理 fake-IP 下的插件链接导入
- 插件音质列表与「自动（最高）/超清母带」
- Android 前台媒体服务、歌词、收藏、播放历史

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.7.apk`
- 大小：5.15 MB
- 包名：`com.ceru.music.mobile`
- versionCode：`23107`
- 最低系统：Android 6.0（API 23）
- SHA-256：`92b07379c119fb5b92c0ff2ff50cea60167b127145f30598844d86e436ed8c67`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
