# 澜音 · CeruMusic 手机版 v2.3.1-mobile.39

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.39

这一版加了运行日志，出问题时可以直接把日志发出来。

## 运行日志

- 「我的」页右上角新增日志入口，有错误时显示红点
- 任意错误提示条上新增「查看日志」，点进去会自动筛选错误日志
- 自动记录：应用启动、播放失败、自动换源、加载超时、插件报错、未捕获异常和 Promise 拒绝
- 日志页支持按「全部 / 错误 / 警告 / 信息」筛选
- 支持「复制全部」和「导出并分享」，导出内容自动附带版本、系统、屏幕、插件列表和账号状态
- 最多保留 1000 条 / 约 1.2MB，超出后自动清理最旧日志
- 不记录账号密码、Cookie、完整 URL 参数和本地文件路径

## 其他修复

- 歌单页的「选择 / 批量选择」入口改成纯文字按钮，不再在没有选中歌曲时显示勾选图标

## 验证

- `vue-tsc` 类型检查、生产构建通过
- 浏览器端到端：错误提示条点击「查看日志」能跳转到日志页并自动筛选错误；日志可持久化、筛选和复制
- Android 原生工程编译通过，APK 使用与原版相同的签名
- 当前环境没有连接 Android 设备，分享面板和真机日志采集未做真机验证

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.39.apk`
- 大小：5682165 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23139`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`c14b46e5313c237e0edb2b060074930ac7a6dd46ffcedf9bc5f9cb4d735e9b52`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
