# 澜音 · CeruMusic 手机版 v2.3.1-mobile.46

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.46

这一版修歌词共享进度延迟、跟不上实际播放的问题。

## 歌词共享

- 修复位置数值丢失：JS 传来的位置是浮点数，原生 `getLong` 只认整数导致进度一直按 0 处理，共享歌词的进度基点反复回到歌曲开头（日志里表现为大量 `stale update 0`）
- 播放中收到略旧于原生估计的进度时，直接向前对齐到原生估计值，不再回退，也不再把歌词基点重置到 0
- 明显异常的旧进度（超过 2 秒的倒退）仍然直接丢弃，正常 seek 走独立通道不受影响
- 日志里会记录对齐（clamp）与丢弃（ignore）事件，方便继续定位

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

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.46.apk`
- 大小：5684662 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23146`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`089abe793208f240a2706190bcd99299482a485af86e6bb143fcac2adee8e389`
- 自签名 APK；覆盖安装请使用同一签名

## Debug 日志版

同一 Release 下另附一个 debug 日志版，使用相同 release 签名，可以直接覆盖安装：

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.46-debug.apk`
- 大小：5684818 字节
- SHA-256：`3ed112c1abca55d292e4754a9814dc04399ab56c65244db3a4562a65f78e4178`
- 额外捕获 `console.log/info/debug`，安装后打开「我的 → 运行日志」即可看到完整日志
- 功能与正式版一致，只是日志更多；复现问题后建议用这个包导出日志

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
