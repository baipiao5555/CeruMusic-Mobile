# 澜音 · CeruMusic 手机版 v2.3.1-mobile.37

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.37

这一版加了两个功能：播放失败自动换源、插件自动检查更新。

## 播放失败自动换源

- 当前音源解析失败或播放失败时，会自动在其它已启用音源里搜索同一首歌
- 匹配歌名和歌手后自动切换并继续播放
- 会提示「『歌曲名』播放失败，已切换到 XX 音源」
- 设置 → 播放 → 新增「播放失败自动切换音源」开关，默认开启

例如酷狗源播放失败时，如果 QQ 音乐源已启用且能搜到同一首歌，会自动切到 QQ 音乐源。

## 插件自动更新

- 从链接安装的插件会记录安装地址
- 打开「音源插件」页时，每个会话自动检查一次更新
- 有新版本会自动下载并替换，提示更新后的版本号
- 每个从链接安装的插件也有「检查更新」按钮，可手动触发
- 从文件安装的插件没有更新地址，需要重新用链接安装一次，之后就能自动更新

## 验证

- 模拟酷狗源解析失败、QQ 源可播放：自动切换到 QQ 源并成功播放
- 模拟插件 v1.0.0 → v1.0.1：检查更新返回 updated=true，插件版本变为 1.0.1
- 设置页新增自动换源开关，默认开启
- `vue-tsc` 类型检查、生产构建通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.37.apk`
- 大小：5675291 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23137`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`a5e6765587fa0152def89e70b65796f03c4cddbcc625fc00d9b5e16a4e730b4d`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
