# 澜音 · CeruMusic 手机版 v2.3.1-mobile.33

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.33

这一版继续修歌单详情页进入后「界面变形」的问题。

## 修正内容

- 进入歌单详情时强制把页面滚回顶部，避免复用上一个页面滚动位置导致一进来就是半截页面
- 歌单顶栏固定并显示歌单名，滚动时返回、重命名、删除始终可见
- 歌单封面卡片压缩到 100px，减少首屏占用
- 页面底部增加渐变遮罩，歌曲列表不会再从迷你播放器和底部导航后面透出来
- 固定顶栏改为不透明背景，避免封面透出

## 验证

- 从已滚动 500px 的歌单列表点击进入详情，详情页滚动位置为 0，顶栏完整显示
- 30 首歌单滚动 700px 后，顶栏仍固定在页面顶部
- 390px 手机宽度下封面、按钮、列表和底部导航无溢出
- `vue-tsc` 类型检查、生产构建通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.33.apk`
- 大小：5675330 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23133`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`fc16951c685b59558cec3194bf64f084e289cab3a0e3ba171401c156eaafbbcb`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
