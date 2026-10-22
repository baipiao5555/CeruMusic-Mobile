# 澜音 · CeruMusic 手机版 v2.3.1-mobile.29

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.29

这一版修复播放记忆：关闭软件再打开后，继续播放会从上次位置开始，而不是回到开头。

## 播放位置记忆

- 播放中每 3 秒保存一次进度（原来 5 秒，且后台可能被节流）
- App 切到后台、页面隐藏、按返回键退出前，立即写入当前播放位置
- 写入时直接读取音频元素的 `currentTime`，避免后台 `timeupdate` 被系统限流导致保存的是旧进度
- 重新打开后恢复上次的播放队列、歌曲和位置；点击播放会从该位置继续

## 验证

- 浏览器进程重启测试：播放后关闭页面，重新打开恢复到最近保存点，队列和歌曲正确
- 触发 `pagehide` / 切后台时立即保存，重新打开恢复到关闭前的位置
- 普通暂停/继续、切歌、退出动画不受影响
- `vue-tsc` 类型检查、生产构建通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.29.apk`
- 大小：5672060 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23129`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`4e53fc6033c45dd650474e664b84c711f11dd1108a5175cc28f9fd13d92822dc`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
