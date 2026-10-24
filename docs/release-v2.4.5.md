# 澜音 · CeruMusic 手机版 v2.4.5

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.4.5

这一版修「我的 → 发现」等底部标签切换时的显示异常。

## 底部标签切换

- 发现 / 搜索 / 歌单 / 我的 四个顶层标签之间改成淡入淡出，不再走整页滑入的 push 动画
- 这对应 MeiloX 里的 `usesHomeAlphaTransition()`：两个顶层页面之间是同一层级的切换，不应使用导航 push
- 修复从「我的」点「发现」时新页面像卡片一样盖在旧页上、旧页内容露出来的显示问题
- 进入歌单详情、设置、播放页等非顶层页面仍然是完整的 Miuix / MeiloX 滑动转场

## 其他

- v2.4.4 已修「关于澜音」显示写死旧版本号的问题，本版继续保留
- 逐字歌词、跟随系统深色模式、检查更新、日志开关均保留

## 验证

- `vue-tsc` 类型检查、生产构建通过
- 浏览器验证：我的 → 发现切换为淡入淡出，不再出现页面叠加；进入歌单详情和返回仍为滑动转场
- 当前环境没有连接小米 13 真机

## 安装

- 文件：`CeruMusic-Mobile-v2.4.5.apk`
- 大小：5686416 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`24005`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`fbbf69e1e41ffd886bc5110ed49f112a58e6f7a9816e03b110fff900ed50b407`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
