# 澜音 · CeruMusic 手机版 v2.3.1-mobile.14

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.14

## 导入歌单：输入处理对齐桌面端

对比桌面端源码后发现一个行为差异：

- 电脑端把输入内容**原样**交给插件
- 手机端之前会先「清洗」成提取出的链接或歌单 ID 再传

部分插件会从整段分享文案里解析参数（例如 `listid` 和 `uid`），被清洗后可能就丢了信息。

这一版改成：

1. 先用**原始输入**调用插件（与电脑端完全一致）
2. 如果失败，再用提取出的链接 / ID 重试一次

两种格式都试过仍然失败时，才会显示错误。

## 关于「我喜欢的歌」

- 「我喜欢」是账号个人收藏，酷狗公开歌单接口不返回它（`special/info` 为 `null`、`special/song` 的 `total` 为 0），本地数字 ID 也无法解析出内容
- 电脑端能导入，通常是因为当时粘贴的是**完整分享链接**（链接里带 `listid`、`uid` 等参数），而不是单独的数字
- 这版对齐输入处理后，请把电脑端用的那串内容原样粘贴到手机重试

如果手机端仍然失败、电脑端可以，请把电脑端当时粘贴的完整内容发出来，按同样的输入排查。

## 继续包含

- 完整默认音质档位、透明沉浸式状态栏、Ionic Vue 外壳、深色主题
- 底部播放任务栏、云歌词匹配、歌单导入错误提示

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.14.apk`
- 大小：5.09 MB（5,336,263 字节）
- 包名：`com.ceru.music.mobile`
- versionCode：`23114`
- 最低系统：Android 6.0（API 23）
- SHA-256：`4de8fe1f63dcb054642e368c01ae51bc0a1d9be61a4551efefc3d7afbba4fae3`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
