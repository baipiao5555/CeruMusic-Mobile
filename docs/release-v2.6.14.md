# 澜音 v2.6.14

## 本机音乐

设置 → 我的 → 本机音乐，可以直接看到手机媒体库里的歌。

- 用 MediaStore 扫描：mp3 / flac / m4a / aac / ogg / wav 等系统能识别的音频都会列出来，
  只读元数据（歌名、歌手、专辑、时长、大小），不改动、不复制你的文件。
- 播放走本机小服务直出 `content://` 流，支持拖动进度、后台播放、锁屏控制，
  和在线歌曲共用同一套播放器。
- 可以在本机音乐页里搜索、播放全部、单独点某一首。

### 权限

- Android 13 及以上：只申请「音乐和音频」（READ_MEDIA_AUDIO），不会碰照片和视频。
- Android 12 及以下：申请读取存储（READ_EXTERNAL_STORAGE）。
- 拒绝授权时页面会说明原因，并给出重新授权入口。

### 关于流量

本机歌曲不经过网络，播放缓存对它们自动跳过；在线歌曲仍然按「播放缓存」开关
边播边存，两者互不影响。

## 校验

- `vue-tsc --noEmit`、`vite build`、`gradle assembleRelease` 通过；`audit.mjs` 23/23 pass。
- APK 内已确认包含 `LocalMediaPlugin` 与两条读取权限。
- APK：`CeruMusic-Mobile-v2.6.14.apk`，versionCode 24032。
