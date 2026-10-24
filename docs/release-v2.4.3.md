# 澜音 · CeruMusic 手机版 v2.4.3

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.4.3

这一版按 MeiloX 的导航动画重做页面转场。

## 导航动画

参考 MeiloX 使用的 Miuix 导航实现，参数对齐 `NavTransitions.MiuixDefault` 和 `NavDisplayEffects`：

- 新页面从右侧整页滑入，旧页面同时向左视差移动 25%
- 旧页面渐暗（亮度 0.55）并轻微降低不透明度到 0.9，模拟 Miuix 的 `dimAmount = 0.5`
- 顶部页面在移动过程中裁切左侧圆角，圆角半径 24px
- 时长 500ms，缓动使用 Miuix 的临界阻尼弹簧曲线（response 0.8 / damping 0.95），不是普通 ease
- 返回时完全反向：当前页面向右滑出，上一页从 -25% 归位并恢复亮度
- 前进/返回方向由 `router.back()` 调用意图判断，不再依赖恒为 1 的 history position
- 系统开启「减少动画」时退化为纯淡入淡出

## 其他

- 保留逐字歌词变色、跟随系统深色模式、关于页检查更新、运行日志/详细日志开关
- 只发布一个安装包

## 验证

- `vue-tsc` 类型检查、生产构建通过
- 浏览器逐帧检查：滑动过程中两页不透明、旧页视差/变暗、左侧圆角裁切、返回方向正确
- 当前环境没有连接小米 13 真机，真机帧率需要在设备上确认

## 安装

- 文件：`CeruMusic-Mobile-v2.4.3.apk`
- 大小：5686350 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`24003`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`ad1ed3720386e451ee86a275eafe150a9ad06912a67c10f2f3eb39fcd55bfb90`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
