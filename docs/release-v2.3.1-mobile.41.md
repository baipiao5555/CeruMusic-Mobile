# 澜音 · CeruMusic 手机版 v2.3.1-mobile.41

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.41

这一版在 v2.3.1-mobile.40 的界面优化基础上，修了歌曲列表里歌手名被挤成省略号的问题。

## 歌曲列表

- 收紧歌曲行的间距、封面和操作按钮尺寸，给歌名和歌手留出更多宽度
- 来源 / 最高音质标签缩小内边距和字号
- 歌手名不再显示专辑后缀，长歌手名会正常省略而不是只剩一个字母
- 播放器、歌单选择入口和选择模式保持 v2.3.1-mobile.40 的样式

## 验证

- `vue-tsc` 类型检查、生产构建通过
- 浏览器 390 × 844 视口检查：歌单页四首歌的歌手名（BEYOND、杨丞琳、晚巧、徐怀钰）都能完整显示；选择模式布局正常
- Android 原生工程编译通过，APK 使用与原版相同的签名
- 当前环境没有连接 Android 设备，真机安装和手势操作未做验证

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.41.apk`
- 大小：5682101 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23141`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`fec2964fffb6a0d401191bf8f774c84e775d47583d3ce6251678f59fb31f01af`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
