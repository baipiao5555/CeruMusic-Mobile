# 澜音 · CeruMusic 手机版 v2.3.1-mobile.17

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.17

这一版解决「每次更新都要手动重新装一遍」的问题：应用内检查更新、下载并覆盖安装，以及一键发版和上游同步检查。

## 应用内更新

- 启动时自动检查 GitHub Release，12 小时最多一次；设置里可以关闭
- 发现新版本会弹出提示，并发一条系统通知（Android 13+ 需要通知权限）
- 设置页新增「检查更新」入口，有新版本时显示红点和版本号
- 更新页展示当前版本、最新版本、发布时间、安装包大小和完整更新说明
- 「下载并安装」直接用应用内的原生下载器拉取 APK，显示进度，完成后调起系统安装器覆盖安装
- 首次安装需要允许「安装未知应用」；应用会自动打开对应设置页，授权后回来再点一次即可
- 更新包来自本项目 GitHub Release，与当前应用使用同一签名，不会清除收藏、歌单、下载记录
- 也可以选择「在浏览器打开」手动下载，或「忽略这个版本」

## 发版和上游同步，不用每次重写

- `npm run release`：一条命令完成 版本号 + versionCode 递增 → 构建 Web 与 APK → 校验签名 →
  生成 SHA-256 → 回填发版说明 → 清理构建产物 → 提交、打 tag、推送 → 创建 GitHub Release
- `npm run release -- --dry-run` 可以只打印步骤，不执行
- `npm run check:upstream`：同时检查桌面版官方更新源、GitHub Release 和本地桌面源码
  `v<当前上游版本>..origin/main` 的新提交，直接告诉你需不需要移植
- 新增 `docs/upstream-sync.md`：记录桌面版到手机版的移植映射、优先级、不能移植的部分和验证步骤
- `package.json` 新增 `upstreamVersion` 字段，记录当前移植到桌面版的哪个版本

## 上游状态

写这一版时检查过：桌面版 GitHub 最新 Release 仍是 **v2.3.1**（2026-10-10），
官方更新源 `update.cerumusic.top` 对 2.3.1 返回 204（已是最新），
本地桌面源码 `v2.3.1..origin/main` 也没有新提交。所以这次没有需要移植的上游改动。

如果桌面版今天提示了更新，可能是重新推送了 2.3.1 或使用了不同渠道；下次桌面版真正发版后，
跑一次 `npm run check:upstream` 就能看到差异清单。

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.17.apk`
- 大小：5362066 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23117`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`48bdbcf8e176f90b6e0b83b931422bcad534bf61f52a64e874ef5a35f2c08134`
- 自签名 APK；覆盖安装请使用同一签名

## 验证

- 类型检查、生产构建 0 报错；Android 原生工程编译通过
- 浏览器端到端：模拟新版本 Release，更新页正确显示版本、说明、大小与按钮；
  设置页出现红点和版本号；「忽略这个版本」后红点消失；自动检查开关状态持久化
- 发版脚本用 `--dry-run` 校验过版本递增、Gradle/apksigner 定位、签名校验和发版步骤
- 上游检查脚本实测：官方更新源 204，GitHub 最新 v2.3.1，桌面源码无新提交

## 说明

本项目只提供插件运行框架、账号同步、下载与更新功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
