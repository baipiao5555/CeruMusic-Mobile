# 澜音 · CeruMusic 手机版 v2.3.1-mobile.13

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.13

## 导入歌单：说明「我喜欢的歌」为什么不支持

这一版没有改导入逻辑（链路本身是通的），而是把失败提示改得更具体：

- 提示里直接说明：**「我喜欢」这类个人收藏通常不能按歌单 ID 读取**
- 给出可操作的做法：用「分享 → 复制链接」粘贴完整链接，或先把歌曲转存成一个公开歌单再导入
- 输入框下方的说明也补上了这一点

## 关于酷狗 ID 18116334

实测酷狗服务端：

- 歌单接口 `special/song?specialid=18116334` 返回 `total: 0`
- 歌单信息接口 `special/info?specialid=18116334` 返回 `data: null`
- 同一接口查公开歌单 `3339907` 返回 30 首歌、正常信息

也就是说，这个数字在酷狗侧不是一个可读取的公开歌单 ID，而是账号里的「我喜欢」收藏。酷狗的公开歌单接口不暴露个人收藏，插件的导入器只能读公开歌单，所以会重试 3 次后报 `try max num`。把歌单设成公开并不能改变这一点。

## 建议的导入方式

1. 在酷狗里新建一个普通歌单（不要用「我喜欢」）
2. 把想导入的歌曲批量添加进去，设为公开
3. 打开该歌单 → 分享 → 复制链接
4. 回到澜音，粘贴完整链接导入（粘贴分享文案也可以，会自动提取链接）

如果使用完整分享链接仍然失败，把输入内容和「插件返回」那行发出来，我再按具体错误排查。

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.13.apk`
- 大小：5.09 MB（5,336,122 字节）
- 包名：`com.ceru.music.mobile`
- versionCode：`23113`
- 最低系统：Android 6.0（API 23）
- SHA-256：`8161fe61024f90343185fafd9f54b9f8e1bcb1ef093bb1d99f0578609ad6fb41`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
