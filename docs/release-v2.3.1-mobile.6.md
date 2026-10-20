# 澜音 · CeruMusic 手机版 v2.3.1-mobile.6

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.6

## 修复：底部播放任务栏

- 播放条从半透明毛玻璃改为实色底栏，避免 Android WebView 把后面的榜单封面透出来，出现灰蒙、重影
- 播放条改为全宽、紧贴底部导航，不再悬浮留缝
- 播放/暂停改为绿色圆形按钮，保留顶部播放进度线
- 点击封面或歌曲信息进入播放页，播放/下一首按钮独立响应
- 页面底部留白按播放条是否显示动态调整，最后一排内容不会被遮挡

## 仍然包含

- 云歌词匹配：LrcLib + QQ 音乐，支持翻译与自动回退
- Android 状态栏颜色/图标跟随主题
- 底部 4 Tab、独立歌单页、歌单导入
- VPN/代理 fake-IP 下的插件链接导入
- 插件音质列表与「自动（最高）/超清母带」
- Android 前台媒体服务、歌词、收藏、播放历史

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.6.apk`
- 大小：5.15 MB
- 包名：`com.ceru.music.mobile`
- versionCode：`23106`
- 最低系统：Android 6.0（API 23）
- SHA-256：`70b03086ced18df7e41a3971d5dd208478db0ff97f12b93692b6fc9d3fc9961a`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
