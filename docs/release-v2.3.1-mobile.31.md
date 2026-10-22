# 澜音 · CeruMusic 手机版 v2.3.1-mobile.31

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.31

这一版优化播放页和设置页的布局。

## 播放页

- 唱片尺寸略微缩小，给歌词和底部控制区留出更多空间
- 进度条、播放控制、音质选择合并到一个半透明玻璃控制面板
- 音质按钮改成单行横向排列，音质多时可左右滑动，不再换行挤压
- 调整歌词区、歌曲信息和底部安全区的间距，小屏幕下更稳定

## 设置页

- 顶部改为「返回 + 设置 + 当前版本」布局
- 账号卡片增加渐变背景和账号层级信息
- 新增设置分类快捷导航：外观 / 播放 / 歌词 / 下载 / 数据，点击平滑滚动到对应区块
- 每个设置区块增加副标题说明，例如「外观 · 主题与配色」
- 收紧卡片和区块间距，长页面浏览更紧凑

## 验证

- 390px 手机宽度下播放页控制面板、歌词、音质按钮无溢出
- 设置分类导航可正确滚动到目标区块
- 播放/暂停、音质切换等原有功能不受影响
- `vue-tsc` 类型检查、生产构建通过

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.31.apk`
- 大小：5675089 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23131`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`82bdbda1824e0c396f1a813ab514de438852b0efbcd27ff0348a4c909ad3843a`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
