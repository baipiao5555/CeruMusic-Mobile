# 澜音 · CeruMusic 手机版 v2.3.1-mobile.36

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.36

这一版修复了真正的界面变形原因，并回退了有问题的播放页/歌单页布局。

## 界面变形的根因

播放歌曲时 `app-shell` 会加上 `has-mini` 类，这个类会把整个应用容器向上顶 152px，导致：

- 进入歌单后顶栏消失
- 歌单封面被裁掉一截
- 页面看起来整体变形

现在移除了 `has-mini` 这个布局方式，底部迷你播放器的空间改为直接包含在页面底部内边距里，不再修改整个应用容器的位置。

## 回退与保留

- 播放页恢复为优化前的稳定布局
- 歌单详情页恢复为优化前的封面卡片布局
- 保留歌单批量选择：全选、下载、加入队列、移出歌单
- 保留重复歌曲行 key 修复，勾选按行号记录，不会再出现没勾却打勾
- 路由切换改为纯淡入淡出，不再整页缩放位移
- 设置页保留上一版的分类导航和账号卡片

## 验证

- 播放歌曲、迷你播放器显示时进入「我喜欢的歌（导入）」：`app-shell` 顶部为 0，页面滚动位置 0，顶栏完整
- 12 首含重复歌曲：初始勾选 0，勾第 1 行显示 1，全选显示 12
- 播放页恢复原布局，播放/暂停、音质按钮、歌词区域正常
- `vue-tsc` 类型检查、生产构建通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.36.apk`
- 大小：5674260 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23136`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`b866005703818b5d353fddc486404b1d0d2069b6c0a959a68f3407441d365fdb`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
