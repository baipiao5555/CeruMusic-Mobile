# 澜音 · CeruMusic 手机版 v2.3.1-mobile.8

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.8

## 大改：状态栏固定深色背景 + 白色图标

之前浅色主题用浅色状态栏，指望系统把时间和信号图标反成深色；部分 MIUI / HyperOS 机型会忽略这个开关，结果就是浅色背景上显示白色图标，几乎看不清。

这一版不再依赖系统反色：

- 浅色主题：状态栏背景固定为深墨绿 `#0B5E46`，图标固定白色
- 深色主题 / 播放页：状态栏背景 `#0B1210`，图标固定白色
- Android 主题里的启动状态栏颜色和图标亮暗也同步改成同一套，冷启动时不会闪回浅色

这样无论系统是否支持状态栏图标反色，时间和信号都保持可读。

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

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.8.apk`
- 大小：5.15 MB
- 包名：`com.ceru.music.mobile`
- versionCode：`23108`
- 最低系统：Android 6.0（API 23）
- SHA-256：`725020f309562a60586b484d9aee83f6ff42646d4566c59647de71706c45b256`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
