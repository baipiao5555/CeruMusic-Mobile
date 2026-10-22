# 澜音 · CeruMusic 手机版 v2.3.1-mobile.42

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.42

这一版补上了迷你播放器的「上一首」按钮。

## 迷你播放器

- 播放器右侧现在是「上一首 / 播放暂停 / 下一首」三个按钮
- 上一首行为与播放页一致：播放超过 4 秒时先回到开头，4 秒内切到上一首
- 播放器卡片的尺寸、圆角和底部导航布局保持不变
- 歌单选择入口、歌曲行间距和歌手名显示保持 v2.3.1-mobile.41 的效果

## 验证

- `vue-tsc` 类型检查、生产构建通过
- 浏览器 390 × 844 视口截图确认：上一首、播放、下一首三个按钮完整显示，歌名和歌手不换行不溢出
- Android 原生工程编译通过，APK 使用与原版相同的签名
- 当前环境没有连接 Android 设备，真机安装和按键操作未做验证

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.42.apk`
- 大小：5682177 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23142`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`9d1ec5e815d4e4d65bfe49d68150eb3af1a9456877c38fa83963c81dea66ba50`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
