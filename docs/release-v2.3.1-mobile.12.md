# 澜音 · CeruMusic 手机版 v2.3.1-mobile.12

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.12

## 导入歌单失败时，提示能看懂原因了

之前插件读取失败时会直接把内部错误抛到界面上，例如：

```
[playlist-importer:import.kg.getTracks] try max num
```

这其实是插件重试 3 次仍然拿不到歌单数据后的兜底错误，用户看不出是「歌单不存在」「需要登录」还是「网络问题」。

这一版会翻译成具体原因，并保留插件原始信息方便排查：

- 读取不到歌单：提示歌单可能已删除、未公开，或 ID 不是歌单 ID
- 需要登录：提示先在音源插件里登录对应平台
- 超时：提示检查网络或 VPN
- 插件不支持该平台：提示更新或更换音源插件
- 解析结果为空时也会说明可能是空歌单、未公开或未登录

原始错误会以小字显示在提示下方（例如「插件返回：try max num」），不影响阅读。

## 关于酷狗歌单 18116334

用服务端实测过：这个 ID 在酷狗侧返回的是错误页（302 到 `error.html?type=special`），移动端接口也返回 `total: 0`，说明该歌单不存在或未公开。换成公开歌单（例如 `3339907`）可以正常读取。也就是说导入链路本身是通的，失败原因是这个歌单本身读不到。

## 继续包含

- 默认音质完整档位（标准 / 高品 / 超高 / 无损 / 超高解析 / 高清臻音 / 全景环绕 / 全景增强 / 超清母带）
- 透明沉浸式状态栏、Ionic Vue 外壳、深色主题修复
- 底部播放任务栏、云歌词匹配、插件音质与前台媒体服务

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.12.apk`
- 大小：5.09 MB（5,336,020 字节）
- 包名：`com.ceru.music.mobile`
- versionCode：`23112`
- 最低系统：Android 6.0（API 23）
- SHA-256：`b6e10991736d66b008ca2e5b251e9c08bc75d289294003d264a2d4169af68025`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
