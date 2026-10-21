# 澜音 · CeruMusic 手机版 v2.3.1-mobile.22

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.22

这一版补上系统歌词共享，并按 MeiloX 的风格重做底栏和动画。

## 歌词共享

参考 MeiloX 的接入方式，实现了两条可用的共享链路：

- **Lyricon Provider**：把当前歌曲、歌词行、翻译发布到 Lyricon 生态。状态栏歌词、锁屏歌词、车机等 Lyricon 接收端可以直接读取。
- **ColorOS / OPlus 锁屏歌词**：在媒体会话的 `MediaMetadata` 中写入 `lyricInfo`（LRC、翻译、歌曲信息），ColorOS 锁屏歌词面板可以直接显示；同时声明了 OPLUS 媒体历史元数据。

设置页新增「歌词共享」：

- **启用歌词共享**：总开关，关闭后清空已发布的歌词
- **共享翻译**：有翻译歌词时一起共享

歌词在加载完成、切歌、暂停/继续、拖动进度时同步给原生服务；原生服务按播放位置更新 Lyricon 的进度与状态，并在服务销毁时清理发布者。

> 说明：Lyricon 的 AAR 声明了 compileSdk 36，而本项目仍使用 AGP 8.2 / compileSdk 34。项目通过 `android.experimental.disableCompileSdkChecks` 放行，并把被依赖提升的 `androidx.core` 固定到 1.13.1；Lyricon 实际使用到的 API 在这个版本里已经存在。ColorOS 链路不依赖任何额外库。

## 悬浮底栏与动画

- 底部导航改为左右留白的悬浮胶囊，毛玻璃背景、圆角和阴影
- 选中项使用会滑动的胶囊指示器，切换时带弹性缓动；图标有轻微放大
- 主页面、播放页、设置等页面切换改为淡入 + 轻微位移的过渡
- 返回主页面再返回时，界面先淡出并缩放到 0.965，再退出 Activity；原生 `finish()` 同时使用系统淡出

## 其他修复

- 搜索页来源标签改为自动换行，标签变多时最后一项不再被裁切
- 恢复播放时如果音频元素还没有音源，会重新解析当前歌曲，而不是在空元素上调用 `play()`；起播超过 25 秒会提示加载超时，不会再一直转圈（暂停/继续异常通常也由这个状态引起）
- 耳机拔出/蓝牙断开的暂停开关现在会真正下发到原生媒体服务

## 验证

- `vue-tsc` 类型检查、生产构建 0 报错
- Android 原生工程编译通过；APK 内已确认包含 Lyricon 类与 `lyricon_module` 清单元数据
- 浏览器端到端：悬浮底栏指示器位置随 Tab 变化；设置页歌词共享、播放模式、耳机暂停、下载音质、同时下载数量均正常渲染并可持久化
- 歌词共享的实际显示效果取决于设备是否安装 Lyricon 接收端或是否为 ColorOS/OPLUS 系统；当前环境没有连接 Android 设备，未做真机验证

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.22.apk`
- 大小：<!-- SIZE --> 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23122`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`<!-- SHA256 -->`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
