# 澜音 · CeruMusic 手机版 v2.3.1-mobile.47

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.47

这一版把之前的 debug 日志版合并进正式包：详细日志改成设置里的开关，只保留一个安装包。

## 详细日志开关

- 「我的 → 设置 → 音源与数据」新增「详细日志」开关（默认关闭）
- 开启后 `console.log / info / debug` 也会写入运行日志，功能等同之前的 debug 版 APK
- 开关即时生效并记住状态，排查完可以随时关掉，不再需要安装第二个包

## 运行日志

- 「我的 → 运行日志」新增原生歌词/播放日志，包含歌词行数、首尾时间、每次位置推送、向后回退被拒绝、seek 等记录
- 导出和分享日志时会自动附带原生日志
- 详细日志开关可以在设置里随时开关，无需单独安装包

## 返回动画

- 页面返回时从左侧滑入，前进时从右侧滑入，并带淡入淡出
- 系统开启「减少动画」时自动退化为纯淡入淡出

## 验证

- `vue-tsc` 类型检查、生产构建通过
- Android Java 编译通过，APK 使用与原版相同的签名
- 浏览器端验证：前进/返回切换时页面 transform 正常，日志页可正常加载
- 当前没有连接小米 13 真机，状态栏歌词的实际效果需要安装后确认；如仍异常，请导出运行日志（现在会包含原生位置记录）

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.47.apk`
- 大小：5685073 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23147`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`ced926741072509facbe41b761ac7dabf43ebcbfa7c8656bfb812967fa84d5f5`
- 自签名 APK；覆盖安装请使用同一签名

## 说明