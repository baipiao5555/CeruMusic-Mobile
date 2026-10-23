# 澜音 · CeruMusic 手机版 v2.3.1-mobile.45

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.45

这一版继续修歌词共享循环开头几句的问题，并补上返回动画和更完整的运行日志。

## 歌词共享

- 改为手动位置模式：每 500ms 把播放位置写入 Lyricon 的共享内存，不再依赖中心服务按 `PlaybackState` 自行外推
- 后台 WebView 计时器被系统限流时，旧的进度回调可能把位置写回更早的值，导致歌词反复回到开头两句；现在播放中的普通更新和进度回调都不会再向后回退
- 新增独立的 seek 通道：用户拖动进度条或主动跳转时仍然可以正常回退
- 插件歌词只有逐字时间、没有行级文本时，用逐字内容拼接出整行，避免只发送前几行
- 继续保留时间轴排序、结束时间补全和 `offsetMs` 偏移处理

## 运行日志

- 「我的 → 运行日志」新增原生歌词/播放日志，包含歌词行数、首尾时间、每次位置推送、向后回退被拒绝、seek 等记录
- 导出和分享日志时会自动附带原生日志
- 另提供 **debug 版 APK**：额外捕获 `console.log/info/debug`，适合复现问题后直接导出完整日志

## 返回动画

- 页面返回时从左侧滑入，前进时从右侧滑入，并带淡入淡出
- 系统开启「减少动画」时自动退化为纯淡入淡出

## 验证

- `vue-tsc` 类型检查、生产构建通过
- Android Java 编译通过，APK 使用与原版相同的签名
- 浏览器端验证：前进/返回切换时页面 transform 正常，日志页可正常加载
- 当前没有连接小米 13 真机，状态栏歌词的实际效果需要安装后确认；如仍异常，请导出运行日志（现在会包含原生位置记录）

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.45.apk`
- 大小：5684677 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23145`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`6b93b6e0641ab2bad9be75c280537c0e60e8723dd6f3185badb2645187c7ae5d`
- 自签名 APK；覆盖安装请使用同一签名

## Debug 日志版

同一 Release 下另附一个 debug 日志版，使用相同 release 签名，可以直接覆盖安装：

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.45-debug.apk`
- 大小：5684814 字节
- SHA-256：`99b68a2238ce950c56f365f99139373353908aa8f78270d066d8425ebbd76e6f`
- 额外捕获 `console.log/info/debug`，安装后打开「我的 → 运行日志」即可看到完整日志
- 功能与正式版一致，只是日志更多；复现问题后建议用这个包导出日志

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
