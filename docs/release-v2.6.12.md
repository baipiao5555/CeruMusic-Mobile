# 澜音 v2.6.12

## 先看日志的结论

你这份 2.6.11 日志里，歌词**每一环都成功了**：

```
LYRIC   插件没给歌词                          ← 音源插件只回了空数组
LYRIC   歌词已加载：36 行                      ← 云端兜底拿到了
LYRIC   下发系统歌词：36 行 / 470 字 · 共享开   ← 已发给系统
LYRIC   系统已接收歌词负载
lyrics  song=E0398A… lines=36 words=470
lyricon provider ready
lyricon setSong lines=36 words=470 id=E0398A…
position pos=5823 playing=true lines=36
```

也就是说，问题不在取词、不在下发、原生也收到了。**小米超级岛本身不吃 Lyricon 的歌词**，
它需要一个「歌词消费者」把歌词渲染到岛上：HyperLyric（6.0 起还要 Lyricon Central），
或者用 HyperLyric 的独立应用模式去读媒体信息里的标题。

## 这一版做了什么

1. **新增「岛歌词兼容」开关**（设置 → 播放）：打开后把当前歌词行写进媒体标题，
   歌名移到专辑位。HyperLyric 的独立应用模式、部分车机蓝牙歌词、以及少数直接读
   媒体标题的岛，都能看到逐行滚动的歌词，不依赖任何 LSPosed 模块。
   开关随进度同步下发，播放中途切换也立即生效。
2. **曲目标识统一**：歌词负载、进度、seek 现在用同一个 `歌曲 key`，
   原生发现标识变化时会重置进度并记一行 `lyrics | id drift`，避免换歌后歌词错位。
3. 新增诊断：`lyricon setSong … mediaId=…`、`island | compat on/off`。

## 怎么用

设置 → 播放 → 打开「岛歌词兼容」→ 播一首歌。
- 通知/媒体卡片上的标题会变成当前歌词行（这是这套兼容方案的工作方式，歌名在副标题）。
- 关掉开关就恢复成正常标题。

如果你已经装了 HyperLyric：把澜音加进它的白名单，并确认 Lyricon Central 与
LyricProvider 都在 LSPosed 里启用（Lyricon 通常需要重启 SystemUI 和澜音一次）。

## 校验

- `vue-tsc --noEmit`、`vite build`、`gradle assembleRelease` 通过；`audit.mjs` 23/23。
- APK：`CeruMusic-Mobile-v2.6.12.apk`，versionCode 24030。
