# 澜音 · CeruMusic 手机版 v2.3.1-mobile.19

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.19

这一版新增**网易云音乐**作为云歌词来源，参考 LyricProvider 支持的平台列表接入。

## 关于 LyricProvider

[LyricProvider](https://github.com/tomakino/LyricProvider) 本身是一个 **LSPosed 模块**：它 Hook 网易云、QQ音乐、Apple Music、酷狗、酷我、汽水、Spotify 等 App 的歌词读取过程，把抓到的歌词提供给车机/状态栏/第三方播放器。它不是可以放进 Capacitor 的歌词库，也没有可调用的公共入口——Apple Music、Spotify、汽水、波点等来源依赖各 App 自己的登录态、签名或本地缓存，脱离 Hook 环境无法复用。

因此手机版走的是另一条路：直接接入这些平台**公开的歌词接口**。目前已经接入：

| 来源 | 状态 | 说明 |
| --- | --- | --- |
| LrcLib | 已有 | 英文歌覆盖好，含同步歌词 |
| QQ音乐 | 已有 | 中文歌，含翻译；搜索请求已修复中文编码问题 |
| 网易云音乐 | **本版新增** | 公开搜索 + 歌词接口，无需登录，含翻译 |
| Apple Music / Spotify / 汽水 / 波点 / 酷狗 / 酷我 | 暂未接入 | 依赖 App 登录态、签名或 Hook 环境，无法直接调用 |

## 网易云歌词

- 搜索：`music.163.com/api/search/get/web`，取前 30 条候选
- 歌词：`music.163.com/api/song/lyric?id=…`，同时读取原文和翻译 `tlyric`
- 只取前 5 首候选请求歌词，避免无意义的请求
- 复用现有的标题/歌手/专辑/时长打分，歌手或标题不匹配的翻唱会被拒绝
- 三家来源并行查询，谁的综合得分高用谁；中文歌给 QQ音乐/网易云少量加权，英文歌给 LrcLib 少量加权
- 播放页的「歌词来源」会显示 `网易云`

## 实测

- 网易云单独命中：`踏浪 / 晚巧`，48 行歌词，得分 130
- 反向验证：`虫儿飞 / 晚巧` 在网易云没有对应版本，返回空，不会错配到郑伊健等翻唱
- 三源联合：`Shape of You / Ed Sheeran` 由网易云胜出，116 行并带中文翻译；`晴天 / 周杰伦` 仍由 LrcLib 命中
- `vue-tsc` 类型检查、生产构建 0 报错，浏览器端到端无 console 错误

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.19.apk`
- 大小：5365248 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23119`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`72d8fc3408671ea7626dc08dea0ed42c87b7bd43256f159512a7cfd71101350b`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载与更新功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
