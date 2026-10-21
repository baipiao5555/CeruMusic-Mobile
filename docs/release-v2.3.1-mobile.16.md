# 澜音 · CeruMusic 手机版 v2.3.1-mobile.16

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.16

这是一次云歌词的补丁版：修复 QQ 音乐音源在中文歌曲上搜不到正确歌词的问题。

## 问题

QQ 音乐搜索接口（`u.y.qq.com/cgi-bin/musicu.fcg`）会把 JSON 请求体里的原始 UTF-8 字节按 GBK 解读。原来的实现直接发送 UTF-8 中文，服务端拿到的是乱码，返回的是一批完全无关的歌，例如搜索「晴天 周杰伦」会返回「多情的海 / 祖海」。结果就是 QQ 音乐这条兜底链路在中文歌曲上基本失效，只剩 LrcLib 在工作。

## 修复

- 发送前把请求体中所有非 ASCII 字符转义成 JSON 的 `\uXXXX` 形式，让请求体保持纯 ASCII，服务端就能正确解码中文查询
- 验证结果：搜索「晴天 周杰伦」返回 8 首正确结果，第一首 mid `0039MnYb0qxYhV`、时长 269 秒（与《叶惠美》原版一致）
- 歌词接口 `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg` 需要 `Referer: https://y.qq.com/`；手机版走原生 SecureHttp 请求，会带上 Referer 和浏览器 UA，实测可以拿到完整 LRC
- LrcLib 链路没有改动，仍作为首选兜底

## 实测

- LrcLib：搜索「晴天 / 周杰伦」返回 20 条结果，含同步歌词；「Shape of You / Ed Sheeran」同样命中
- 浏览器端到端：插件不提供歌词时，播放《晴天》自动匹配到 42 行歌词，《Shape of You》匹配到 90 行，播放页显示歌词来源
- QQ 音乐：搜索与歌词接口用真实网络请求验证通过（请求体转义后的返回结果正确）；由于浏览器禁止设置 `Referer` 请求头，QQ 歌词只能在手机原生请求下生效，浏览器调试时会自动回退到 LrcLib
- 类型检查、生产构建 0 报错

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.16.apk`
- 大小：5.11 MB（5,356,076 字节）
- 包名：`com.ceru.music.mobile`
- versionCode：`23116`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`e6cad45a49bc371b259b49285854b1a90ffd9c318028a3c27eeb6fbbbb5b1938`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步与下载功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
