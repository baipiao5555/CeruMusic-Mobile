# 澜音 · CeruMusic 手机版 v2.3.1-mobile.28

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.28

这一版补上退出应用时的动画，同时合入上一轮的代码清理。

## 退出动画

在首页、搜索、歌单、我的这四个根页面按返回键退出时：

- 整个界面先缩小到 90%、向下轻移并淡出，持续约 260ms
- WebView 动画结束后，原生 Activity 再用淡出动画关闭
- Android 14+ 使用新的 activity transition API，旧版本使用兼容的自定义动画

说明：从最近任务上滑关闭、或按 Home 键回桌面，动画由系统桌面控制，应用无法自定义；返回键退出会走上面的动画。

## 其他

- 合入上一轮清理：移除未使用的导出、函数和局部变量，播放器重复逻辑合并，类型检查开启未使用代码检查
- 无功能行为变化

## 验证

- `vue-tsc` 类型检查、生产构建通过
- Android Release APK 构建通过，签名校验通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.28.apk`
- 大小：5672012 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23128`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`80f5e9171b482942c29529815747c392cd5d60eb5b10ea6fc37ae1d6bf01e3fd`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
