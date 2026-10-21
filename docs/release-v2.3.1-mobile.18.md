# 澜音 · CeruMusic 手机版 v2.3.1-mobile.18

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.18

这一版补齐通知栏和锁屏的播放信息：**实时封面**和**播放进度**。

## 通知栏 / 锁屏封面

- 播放时把当前歌曲的封面 URL 交给 Android 前台媒体服务，由原生代码下载图片并缓存
- 封面同时写入三处：通知大图标、`MediaSession` 的专辑封面、部分 OEM 锁屏使用的显示图标
- 切换歌曲会立即换图；同一张封面重复播放只下载一次
- 图片最多解码到 1024px，缓存上限 8 MB，不会因为大图占用过多内存
- 封面下载沿用与插件请求相同的公网校验：只允许 HTTP(S)，拒绝 localhost、回环、私有和保留地址，逐跳校验重定向

## 播放进度

- 原生媒体服务每秒更新一次 `MediaSession` 的播放位置与播放速率，锁屏和通知里的进度条会平滑前进
- WebView 每 5 秒把真实播放位置同步给原生，避免长时间播放产生漂移
- 拖动进度条、暂停、切歌时立即同步位置
- 通知本身也带 `setProgress`，在支持进度条的通知样式里可以直接看到

## 兼容性说明

- Android 13+ 的系统媒体卡片会直接读取 `MediaSession` 的进度与封面
- MIUI / HyperOS 等 OEM 的锁屏和通知样式读取的是大图标与 `MediaMetadata`，这次两者都写入
- 如果封面地址来自需要鉴权的音源，原生下载可能拿不到图片，此时会显示应用图标；歌曲信息和进度不受影响

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.18.apk`
- 大小：<!-- SIZE --> 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23118`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`<!-- SHA256 -->`
- 自签名 APK；覆盖安装请使用同一签名

## 验证

- `vue-tsc` 类型检查、生产构建 0 报错；Android 原生工程编译通过
- 已确认前台媒体服务包含封面下载、缓存、`MediaMetadata` 写入和每秒进度更新逻辑
- 通知/锁屏的实际显示效果与具体 ROM 的通知样式有关，建议在手机上播放一首歌后确认封面和进度

## 说明

本项目只提供插件运行框架、账号同步、下载与更新功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
