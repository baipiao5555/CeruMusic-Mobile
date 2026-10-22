# 澜音 · CeruMusic 手机版 v2.3.1-mobile.26

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.26

这一版修复播放/暂停按钮图标在当前页面不刷新的问题。

## 图标状态不刷新

`Icon` 组件在创建时只计算了一次 SVG 路径，之后父组件切换 `name`（播放 ↔ 暂停）时图标不会更新；只有离开播放页再重新进入、组件重新创建后才显示正确状态，看起来就像「点了没反应」。

现在图标路径改为响应式计算，`name` 变化会立即刷新。除了播放页和迷你播放器的播放/暂停按钮，同样受影响的收藏心形、循环模式等动态图标也一并恢复正常。

## 验证

- 浏览器端到端：播放页停在当前页面连续点击播放/暂停，SVG 路径按 pause → play → pause 立即切换，无需返回重进
- 收藏按钮点击后心形图标立即在空心/实心之间切换
- `vue-tsc` 类型检查、生产构建 0 报错

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.26.apk`
- 大小：5671665 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23126`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`7f2844621479c1fa4efc64d68fd198b50b0fe4a2a6b7523c031663f3aac33872`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
