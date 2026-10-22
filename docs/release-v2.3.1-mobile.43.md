# 澜音 · CeruMusic 手机版 v2.3.1-mobile.43

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.43

这一版修歌词共享只循环显示一行的问题。

## 歌词共享

- 修正插件歌词的时间轴：未提供行级开始时间时，用第一个逐字时间兜底，不再把每一行都当成 0 毫秒
- 按开始时间排序后再发送，避免插件返回顺序不固定导致中心服务只命中一行
- 行结束时间缺失时取下一条歌词的开始时间，不再统一补 5 秒造成多行重叠
- 应用插件歌词的 `offsetMs` 偏移
- Android 原生层再做一次排序和结束时间校验，防止空时间轴或重叠时间轴进入 Lyricon
- 歌词加载后会在运行日志里记录行数和首尾时间，后续仍异常可以直接导出日志定位

## 验证

- `vue-tsc` 类型检查、生产构建通过
- Android Java 编译通过，APK 使用与原版相同的签名
- 小米 13 未连接当前环境，状态栏歌词的实际显示需要安装后确认；如果仍然只显示一行，请在「我的 → 运行日志」导出日志，里面会包含 `歌词已加载：N 行` 和首尾时间

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.43.apk`
- 大小：5682989 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23143`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`6a9f8b041a904fda170ab1c6f4b9476e379795dae22b93f0c4e4fbb0353ec101`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
