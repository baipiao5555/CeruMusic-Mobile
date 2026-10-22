# 澜音 · CeruMusic 手机版 v2.3.1-mobile.38

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.38

这一版修了歌词共享的进度不同步，并在歌曲列表显示来源与最高音质。

## 歌词共享进度

- 修正发给 Lyricon 的调用顺序：先同步播放状态，再写带速度的 PlaybackState，最后写位置
- 播放中每 500ms 刷新一次位置，中心服务在两次刷新之间按速度自行外推
- 切歌、暂停/继续、拖动进度后会立即补齐状态和位置，不再从 0 开始
- 跳变超过 2 秒时明确发送 seek，避免状态栏歌词慢慢追进度
- 设置 → 歌词共享里的总开关、共享翻译继续有效

## 歌曲来源与最高音质

- 歌曲列表的第二行新增两个小标签：
  - 橙色标签显示这首歌可用的最高音质，例如「无损」「超高」「标准」
  - 蓝色标签显示来源，例如 `kg`、`tx`、`wy`
- 标签按音质档位排序取最高，不依赖插件返回数组的顺序
- 本地歌曲不显示来源标签；没有音质信息时只显示歌手

## 验证

- `vue-tsc` 类型检查、生产构建通过
- Android 原生工程编译通过，APK 使用与原版相同的签名
- 浏览器端到端：搜索页歌曲行正确显示「标准」+ `demo` 标签，长歌手名会自动省略
- 歌词共享的实际显示效果取决于设备是否安装 Lyricon 接收端或是否为 ColorOS/OPLUS 系统；当前环境没有连接 Android 设备，未做真机验证

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.38.apk`
- 大小：<!-- SIZE --> 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23138`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`<!-- SHA256 -->`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
