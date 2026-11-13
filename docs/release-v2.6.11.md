# 澜音 v2.6.11

## 日志拉满

- 默认开启详细日志：`console.log / info / debug` 都会写进运行日志，不再只有错误。
- 容量：条目上限 1000 → 3000，总字数上限 1.2MB → 2.5MB（仍在 localStorage 安全范围内）。
- 新增日志类别：
  - `PLAYER` 开始播放：曲目、音源、插件、ref 类型与 id、起始位置、时长。
  - `LYRIC` 下发系统歌词：行数、逐字数、共享开关状态、负载大小。
  - `LYRIC` 系统已接收歌词负载 / 下发失败的原文错误。
  - `SETTINGS` 每次改设置：改了哪些键，以及当前 `--sans`、`--serif`、`body` 实际字体。
  - `LYRIC` 这首歌没有可用音源插件时的提示。

## 原生不再吞异常

歌词发布到系统（Lyricon 岛 / 锁屏）时，之前失败是完全静默的。现在这些位置都会写进原生诊断
（日志页会一起显示）：

- `lyricon | provider ready` / `provider unavailable: …`
- `lyricon | skip publish: no provider`
- `lyricon | publish failed: …`
- `lyrics | parse failed: …`
- `lyrics | cleared: enabled=… lines=…`

配合 JS 侧的 `LYRIC` 行，可以一眼看出是「没拿到歌词」「拿到了但没发出去」还是「发出去了但系统没发布」。

## 字体：系统默认真的回到系统

「系统默认」的字体栈原来以 `Inter` 开头，`Inter` 在手机上不存在，浏览器的回退顺序里又混着
随包内置的字体名，某些机型上会停在上一档的观感。现在：

- 系统默认 = `system-ui, -apple-system, Roboto, Noto Sans SC, PingFang SC, HarmonyOS Sans SC, Microsoft YaHei, sans-serif`，
  不含任何内置字体，标题的衬线也退回 Georgia / 宋体族。
- 其余四档（文楷、得意黑、宋体衬线、等宽）不变。

## 校验

- `vue-tsc --noEmit`、`vite build`、`gradle assembleRelease` 通过。
- 日志验证：切换字体后日志里能看到 `SETTINGS 设置已更新：fontFamily=wenkai` 与三段实际字体栈。
- APK：`CeruMusic-Mobile-v2.6.11.apk`，versionCode 24029。
