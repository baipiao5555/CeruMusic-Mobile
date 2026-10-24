# 澜音 · CeruMusic 手机版 v2.4.2

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.4.2

这一版重做页面转场，修掉上一版两页半透明叠在一起、返回方向识别错误的问题。

## 页面转场

- 改成原生 push 风格：新页面从右侧整页滑入，旧页面向左轻微位移，全程不透明，不再出现两页文字叠影
- 返回时旧页面向右滑出，上一页从左侧轻微归位；前进和返回方向都正确
- 修正返回方向判断：不再依赖 `history.state.position`（hash 模式下它恒为 1），改为跟踪 `router.back()` 的调用意图
- 转场时长 0.32s，使用接近系统级转场的缓动
- 系统开启「减少动画」时退化为纯淡入淡出

## 其他

- 保留逐字歌词变色、跟随系统深色模式、关于页检查更新、运行日志/详细日志开关
- 只发布一个安装包

## 验证

- `vue-tsc` 类型检查、生产构建通过
- 浏览器验证：前进/返回时两页不透明滑动、返回方向正确、无叠影
- 当前环境没有连接小米 13 真机，真机滑动帧率需要在设备上确认

## 安装

- 文件：`CeruMusic-Mobile-v2.4.2.apk`
- 大小：5686072 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`24002`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`7cba5d07e9cfd4755d8e163f2bf24d2652687164a2d63e8cbba5f9de4ae3598d`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
