# 澜音 · CeruMusic 手机版 v2.4.8

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.4.8

这一版修「歌词共享」：共享出去的歌词逐字变色和滚动动画跟不上播放进度。

## 问题原因

- 位置每 **500ms** 才向 Lyricon 推一次，而官方 Provider SDK 的默认节奏是 **41ms**（约 24 帧/秒）。中心服务靠这个间隔读进度来推进变色和动画，500ms 就成了「一格一格跳」
- 插件给的**逐字时间**（每句里每个词的开始/结束）在归一化时被直接丢掉，只留下整行时间，所以只能整行切换、没法逐字变色
- 播放页调「歌词偏移」只影响应用内，共享出去的时间轴没跟着平移，两边会越差越多

## 修复内容

- 逐字歌词时间完整保留：补全缺失的词尾、按行裁剪、校验「逐字文字拼起来 = 整行文字」，对不上就不用，避免高亮错字
- 共享时间轴与原生结构统一由 `core/lyrics/timeline.ts` 生成，行尾缺失时用下一行开头兜底
- 原生改为每 41ms 推送一次位置（`setPositionUpdateInterval` 同步改成 41ms），逐字变色、滚动动画跟得上
- 原生解析 `words` 生成 Lyricon 的 `LyricWord`，`setSong` 前调用官方的 `normalize()` 做排序与时长修正
- 歌词偏移现在同时作用于共享时间轴，调完立刻重新发布
- 原生诊断日志新增 `words=` 计数，方便确认逐字数据有没有到位

## 验证

- `src/core/lyrics/timeline.ts` 单测 8 项全部通过：逐字补全、文字校验、少于两字不启用、按行裁剪、偏移平移、负偏移、原生结构键名、行尾兜底
- 逐字歌词端到端 6 项全部通过：插件返回的逐字时间一路保留到播放状态，翻译与非逐字行不受影响
- Android `compileReleaseJavaWithJavac` 编译通过
- 当前环境没有连接真机，实际动画效果需要在手机上确认（Lyricon / 灵动岛 / 锁屏歌词）

## 说明

- 逐字变色取决于音源是否提供逐字歌词；只有 LRC 行级时间的歌（比如部分云端匹配歌词）仍然是整行进度
- 位置刷新频率提高后，播放时的耗电会比之前略高一点，这是逐字歌词动画的代价

## 安装

- 文件：`CeruMusic-Mobile-v2.4.8.apk`
- 大小：5691348 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`24008`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`a307255ec2db039219ee655f593d473b85da55d23ea5264bf67299824cd3dd82`
- 自签名 APK；覆盖安装请使用同一签名
