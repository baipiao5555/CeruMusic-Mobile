# 澜音 · CeruMusic 手机版 v2.3.1-mobile.11

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.11

## 修复：默认音质选项变少

从 v2.3.1-mobile.2 起，设置页的音质列表改成「只显示当前插件声明的档位」。示例音源只声明了 `128k`，于是列表只剩「自动 + 标准」两项。

这一版改成：

- 设置页始终展示完整音质档位：标准 / 高品 / 超高 / 无损 / 超高解析 / 高清臻音 / 全景环绕 / 全景增强 / 超清母带
- 插件自己声明的档位会合并进列表（自定义音质也会显示）
- 如果当前音源没有所选档位，播放时仍按原有逻辑自动回落到最接近的可用档位，不会报错
- 音质按钮改为自动换行，档位多时不再横向溢出

播放页的音质按钮保持原样：它显示的是当前歌曲实际可用的音质，用于临时切换。

## 继续包含

- 透明沉浸式状态栏：页面渐变延伸到屏幕顶部，图标明暗跟随主题，原生测量刘海/手势条安全区
- Ionic Vue 外壳与图标、发现页重做、深色主题修复
- 底部播放任务栏、云歌词匹配、歌单导入、插件音质与前台媒体服务

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.11.apk`
- 大小：5.09 MB（5,335,470 字节）
- 包名：`com.ceru.music.mobile`
- versionCode：`23111`
- 最低系统：Android 6.0（API 23）
- SHA-256：`853e074a3f0d4f2f00b0b5ebf9f3e4960d79bdb7cbe3b6bd08e69ddfa7d0c3c6`
- 自签名 APK；覆盖安装请使用同一签名

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
