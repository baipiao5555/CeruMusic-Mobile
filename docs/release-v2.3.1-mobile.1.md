# 澜音 · CeruMusic 手机版 v2.3.1-mobile.1

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

## 安装包

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.1.apk`
- 大小：5.0 MB
- 包名：`com.ceru.music.mobile`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`64603602c7059770648d82bfcfd700cbfa911dba36347b0ccd9f72fcfdd92d77`
- 自签名 APK；后续升级请使用同一签名

## 已实现

- 澜音 v2 插件：链接安装、文件安装、启用/停用、卸载、配置、权限确认、Ed25519 签名校验
- 官方插件沙箱（iframe + postMessage）与 Host RPC
- 发现页榜单/推荐歌单、音源搜索
- 播放队列、上下首、随机/单曲/列表循环、进度拖动、音质切换
- 逐行歌词与点击跳转
- 收藏、本地歌单、播放历史
- Android 前台媒体服务：后台播放、通知栏与锁屏控制
- 浅色/深色/跟随系统主题，移动端安全区适配

## 安全

- 插件安装只静态解析清单，不执行插件代码
- 插件运行在 `sandbox="allow-scripts"` 的独立 iframe
- 插件网络请求仅允许公网 HTTP(S)，拒绝 localhost、回环、私有与保留地址
- Android 原生请求层手动处理重定向，并对每一跳做 DNS 解析与私网校验
- 响应体 16 MB 上限、60 秒超时、最多 5 次重定向

## 未移植

桌面版的社区、AI、一起听、账号、本地扫描/标签编辑、下载管理、DLNA，以及插件的 Web/Native Surface 页面。部分插件服务接口会提示「手机版暂不支持」。

## 验证

- 浏览器端到端测试：插件安装、沙箱、榜单、搜索、播放、歌词、收藏/歌单全部通过，生产构建 0 报错
- 带签名插件产物的验签与运行通过
- 公网 HTTP 请求成功；`127.0.0.1` 请求被安全策略拦截
- APK 通过 `apksigner` v1/v2 签名校验，清单包含媒体前台服务与所需权限

## 说明

本项目只提供插件运行框架与播放功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
