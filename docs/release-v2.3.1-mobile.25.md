# 澜音 · CeruMusic 手机版 v2.3.1-mobile.25

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.25

这一版修复播放地址解析期间点暂停没有反应的问题。

## 加载中暂停

歌曲地址还在解析时，播放按钮虽然会短暂切换状态，但这次解析并没有被取消；地址返回后仍会开始播放，看起来就像「暂停没反应」。

现在在解析期间按暂停会：

- 立即取消这次待开始的播放，地址返回后不会再自动播放
- 停止加载状态并清掉加载超时计时器
- 再按播放时从当前歌曲正常重新开始
- 通知栏 / 锁屏的暂停操作同样生效；正常播放中的暂停行为不变

## 验证

- 浏览器端到端：用延迟 1.5 秒解析的音源，加载中点击暂停后 `loading`、`playing` 均为 `false`，2.2 秒后地址返回仍未播放；再次点击播放可正常开始
- 直接调用 `pause()` 取消加载同样通过；正常播放中暂停/继续正常
- `vue-tsc` 类型检查、生产构建 0 报错

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.25.apk`
- 大小：5671741 字节
- 包名：`com.ceru.music.mobile`
- versionCode：`23125`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`2e205990302a2d1f3585f885b40f8931aa4147ea41d987e99b9759658b68f0eb`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架、账号同步、下载、更新与歌词共享功能，不存储、不提供任何音乐文件。
请确保安装和使用的插件符合当地法律法规。
