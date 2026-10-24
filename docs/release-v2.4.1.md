# 澜音 · CeruMusic 手机版 v2.4.1

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.4.1

这一版修主题跟随系统、继续优化页面动画，并把检查更新移到了「关于澜音」。

## 主题跟随系统

- 不再依赖 WebView 的 `prefers-color-scheme`（Android WebView 切深色后经常不刷新）
- 新增原生主题读取：启动时读取系统 night mode，并在系统深浅色切换时主动通知页面
- 选择「跟随系统」后，切换手机深色模式会立即同步应用主题、状态栏和导航栏

## 页面动画

- 前进/返回改成两页同时过渡：新页面滑入，旧页面轻微后退并变暗，不再先等旧页消失
- 进入用弹性缓动（0.42s），退出更快（0.34s），整体更接近系统级转场
- 系统开启「减少动画」时退化为纯淡入淡出

## 关于与更新

- 「设置 → 关于澜音」现在显示当前版本，并新增「检查更新」入口
- 发现新版本时会在「关于澜音」里显示角标，点进去即可下载安装
- 移除了「音源与数据」里重复的检查更新入口
- 「运行日志」和「详细日志」开关保持在「音源与数据」中

## 验证

- `vue-tsc` 类型检查、生产构建通过
- Android Java 编译通过，APK 使用与原版相同的签名
- 浏览器验证：系统主题覆盖可切换 dark/light，前进/返回过渡同时存在两页且无空白，关于页版本与更新入口正常
- 当前环境没有连接小米 13 真机，系统深色切换需要在真机上确认

## 安装

- 文件：`CeruMusic-Mobile-v2.4.1.apk`
- 大小：5686048 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`24001`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`ba0d149540b3dad8d0e8f6bce5542ecc259dc087b4b931859f47384f763f7ddf`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
