# 澜音 · CeruMusic 手机版 v2.3.1-mobile.15

基于 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) v2.3.1 移植的 Android 应用。

- GitHub 仓库：https://github.com/baipiao5555/CeruMusic-Mobile
- Release 下载：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/v2.3.1-mobile.15

这一版加了三件事：**澜音账号登录**、**云歌单同步**、**歌曲下载**。

## 登录：和电脑版共用同一个澜音账号

- 设置页新增账号卡片，云端歌单页也有登录入口
- 使用澜音账号的 OAuth 2.0 授权码流程，带 PKCE（S256）、state 与 nonce 校验
- 登录页在**系统浏览器**中打开，应用不接触密码
- 授权完成后通过 `cerumusic://oauth/callback` 深链回到应用，自动刷新云歌单
- token 到期会自动用 refresh token 续期；退出登录只清除本机凭据，不影响电脑端
- 用户昵称、头像从 ID token 读取，不额外上传个人信息

## 云歌单：把电脑上的歌单同步到手机

- 读取电脑版「上传到云端」的歌单列表，显示封面、更新时间、是否已导入
- 单个「导入 / 更新」，也可以「全部导入」
- 导入时按 `pluginResource` 匹配本机已安装的音源插件；匹配不到的音源会保留歌曲信息并提示「未匹配音源」
- 已导入过的歌单会原地更新歌曲列表，不会产生重复歌单
- 歌单页新增「云端」入口，导入后歌单会标记「来自云端」

> 同步是单向的：电脑版负责上传到云端，手机版负责读取导入。手机端的改动不会回写云端。

## 下载：真正的离线播放

- 新增原生流式下载器（Java），边下边写盘，不占 WebView 内存
- 实时进度、已下载大小、总大小；服务器不返回长度时显示不确定进度
- 支持取消、失败重试、删除文件、清理全部已完成
- 下载完成后再播放同一首歌，会直接读取本地文件，断网也能听
- 歌曲行新增下载按钮，歌单详情新增「下载全部」
- 新增「下载管理」页：进行中 / 已完成 / 失败分组状态、播放、重试、删除
- 文件保存在应用专属目录（`Android/data/com.ceru.music.mobile/files/Music`），无需存储权限，卸载应用会一并删除
- 插件发起的 `services.downloads.*` 也已接通：list / create / pause / resume / cancel / retry 可用，`reveal` 不支持

## 其他

- 插件 `services.app.getInfo` 现在返回真实版本号（之前固定为 mobile.5）
- 音源解析逻辑抽到 `core/playback/source.ts`，播放与下载共用同一套音质选择与请求头处理
- 下载器对每一跳重定向重新做公网校验；跨域重定向会丢弃 Authorization、Cookie 等敏感请求头

## 安装

- 文件：`CeruMusic-Mobile-v2.3.1-mobile.15.apk`
- 大小：5.11 MB（5,356,078 字节）
- 包名：`com.ceru.music.mobile`
- versionCode：`23115`
- 最低系统：Android 6.0（API 23），targetSdk 34
- SHA-256：`da2e19eba7b043f4cd3a70df5aff5fb0ff7e4c0a72d9861fed08dd2a7804b142`
- 自签名 APK；覆盖安装请使用同一签名

## 验证

- `vue-tsc` 类型检查、生产构建 0 报错
- 浏览器端到端：登录 URL 参数（PKCE / state / resource）、回调错误与 state 校验、搜索、下载完成、下载页、云端登录页、设置账号卡片全部通过
- Logto 授权地址返回 200；token 端点对无效 code 返回 `invalid_grant`（说明 client_id 与 PKCE 流程有效）
- 云歌单接口未登录返回 401，鉴权链路符合预期
- APK 通过 `apksigner` 签名校验；清单包含 `cerumusic://oauth` 深链、`Downloader` 与 `External` 原生插件

## 说明

本项目只提供插件运行框架、账号同步与下载功能，不存储、不提供任何音乐文件。请确保安装和使用的插件符合当地法律法规。
