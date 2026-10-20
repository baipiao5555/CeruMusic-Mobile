# 澜音 · CeruMusic 手机版 v2.3.1-mobile.4

## 修复

- 修复 Android 状态栏颜色和图标不跟随应用主题的问题
  - 启动页主题补上 `postSplashScreenTheme`，启动后切换到正常的无 ActionBar 主题
  - 浅色主题：状态栏使用应用背景色 `#EEF7F3` + 深色图标
  - 深色主题：状态栏使用 `#0B1210` + 浅色图标
  - 播放页单独使用深色状态栏，避免顶部出现灰色/不协调色块
  - 同步设置底部导航栏颜色
- 之前出现的顶部灰色条不再出现

## 仍然包含

- 底部 4 Tab：发现 / 搜索 / 歌单 / 我的
- 独立歌单页、新建/导入快捷操作
- 插件链接在 VPN/代理 fake-IP 环境下的导入修复
- 插件歌单导入、插件音质列表与「自动（最高）/超清母带」
- Android 前台媒体服务、歌词、收藏、播放历史

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.4.apk`
- 大小：5.0 MB
- 包名：`com.ceru.music.mobile`
- versionCode：`23104`
- 最低系统：Android 6.0（API 23）
- SHA-256：`113c802dfe0e3498fd4b073fb68bff35f73b646fbe17de35f6f60000eeb772ef`
- 自签名 APK；覆盖安装请使用同一签名

## 验证

- APK 资源已确认包含 `statusBarColor`、`windowLightStatusBar`、`postSplashScreenTheme`
- 浅色/深色主题与播放页的状态栏颜色、图标样式会同步切换
- 生产构建端到端流程控制台 0 报错
