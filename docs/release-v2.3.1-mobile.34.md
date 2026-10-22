# 澜音 · CeruMusic 手机版 v2.3.1-mobile.34

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.34

这一版修复云歌单「我喜欢的歌（导入）」进入后界面异常和批量选择勾选错乱。

## 问题原因

云导入歌单里可能存在重复歌曲，列表原来只用 `providerId + trackId` 作为行 key，重复歌曲会导致：

- Vue 复用了错误的歌曲行，进入歌单时列表排版错乱
- 批量选择的勾选状态串行，没勾的歌曲也显示对号

## 修复内容

- 歌单行 key 改为 `providerId + trackId + 行号`，重复歌曲也各自独立
- 批量选择改为按「行号」记录，不再按歌曲身份记录；勾选哪一行就只勾哪一行
- 进入歌单时强制滚回顶部，避免继承上一页滚动位置
- 去掉封面大图的高斯模糊背景，避免部分 Android WebView 出现渲染变形
- 固定顶栏、紧凑封面、底部渐变遮罩保留

## 验证

- 用 30 首包含重复歌曲的歌单测试：进入时滚动位置为 0，顶栏完整显示
- 进入批量选择：初始勾选数为 0；勾第 1 行只显示 1 个勾；全选后 30 个勾
- 重复歌曲不再出现「没选却打勾」或批量勾选串行
- `vue-tsc` 类型检查、生产构建通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.34.apk`
- 大小：5675244 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23134`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`9ef6bff32c29adef1f4fb74e144cfaa41fc93f40c5239aa61be6f940afcae320`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
