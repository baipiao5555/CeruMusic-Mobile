# 澜音 · CeruMusic 手机版 v2.4.4

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.4.4

这一版修「我的 → 关于澜音」里一直显示旧版本号的问题。

## 关于澜音版本号

- 「我的」页关于入口和弹出的关于对话框之前把版本写死成了 `2.3.1-mobile.2` / `2.3.1-mobile.5`，所以即使装了新包也显示旧版本
- 现在两处都读取应用构建版本，安装 v2.4.4 后会显示 `2.4.4`
- 设置页「关于澜音」显示的当前版本也来自同一个构建版本

## 其他

- v2.4.3 的 MeiloX / Miuix 导航动画、逐字歌词、跟随系统深色模式、检查更新、日志开关均保留
- 只发布一个安装包

## 验证

- `vue-tsc` 类型检查、生产构建通过
- 浏览器验证：关于入口和弹窗都显示当前构建版本
- 当前环境没有连接小米 13 真机

## 安装

- 文件：`CeruMusic-Mobile-v2.4.4.apk`
- 大小：5686341 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`24004`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`0666f3bd249cff78dd6feba9f33ebcdaf1e44fd69b5e12f545c7ed3f7c6ecc72`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
