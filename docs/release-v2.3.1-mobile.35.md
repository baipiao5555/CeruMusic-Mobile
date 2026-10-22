# 澜音 · CeruMusic 手机版 v2.3.1-mobile.35

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.35

这一版继续处理进入歌单后的界面变形问题。

## 修正内容

- 路由切换动画从「位移 + 缩放 + 淡入」改为纯淡入淡出，避免进入歌单瞬间整页缩放位移
- 歌单顶栏改为 fixed 固定定位，不再依赖 sticky；即使滚动容器异常，顶栏也不会消失
- 进入歌单强制滚回顶部，避免继承上一页滚动位置
- 歌单列表行 key 加入行号，重复歌曲不再复用错误行
- 批量选择按行号记录，解决「没勾选却显示对号」的串行问题
- 去掉封面高斯模糊背景，避免部分 Android WebView 渲染异常

## 验证

- 从已滚动的歌单列表进入详情，滚动位置为 0，顶栏完整显示
- 30 首含重复歌曲的歌单：初始勾选 0，勾第 1 行只显示 1 个勾，全选显示 30
- 歌单滚动 500px 后 fixed 顶栏位置仍为 y=0
- 390px 手机宽度下封面、按钮、列表和底部导航无溢出
- `vue-tsc` 类型检查、生产构建通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.35.apk`
- 大小：5675202 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23135`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`8850734f837ef4aa98a3caa10b025ba749304c41d95fd500e08958bdf6747ce5`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
