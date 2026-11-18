# 澜音 v2.6.26 · 平台歌单、WebDAV 音乐库、删除同步与全局自动同步

本版把上一轮遗留的四个问题继续推进：平台歌单支持网易云 / QQ 音乐账号目录和酷我 / 咪咕公开歌单链接，WebDAV 增加远端音乐扫描与播放，WebDAV 双向同步开始安全传播删除，自动同步改为应用级调度并增加 Android 前台保活壳；酷狗和汽水仍明确标注不支持，不展示残缺歌单或伪造成功结果。

## 平台登录与歌单

- **网易云**：保留账号歌单目录读取；`account/get` 确认身份 → `user/playlist` 读取目录 → `v6/playlist/detail` 读取有序曲目 → `song/detail` 补全详情页缺失曲目。
- **QQ 音乐**：新增账号歌单目录读取；使用 `fcg_user_created_diss` 读取“创建的歌单”，再用 `fcg_ucc_getcdinfo_byids_cp` 读取曲目。请求使用 Keystore 会话 Cookie、确认后的 UIN 和由 `qm_keyst` 计算的 `g_tk`。
- **酷我**：新增公开歌单链接 / 数字 ID 导入；使用官网 `/api/www/playlist/playListInfo`，请求携带登录后取得的 `Hm_Iuvt_...` Cookie、`Secret` 签名和固定 Referer。酷我网页没有公开的账号歌单目录接口，因此不显示虚假目录。
- **咪咕**：新增公开歌单链接 / 数字 ID 导入；使用 `resource/playlist/v2.0` 和 `MIGUM3.0/resource/playlist/song/v2.0` 分页读取完整曲目，不需要登录。咪咕账号目录仍需要真实登录态验证。
- **酷狗**：公开 JSON 实测只返回前 10 首，分页参数未生效；账号目录依赖 App 私有签名接口。当前明确不支持，避免把残缺歌单当成成功。
- **汽水**：普通用户网页会话尚未接入，明确不支持。
- 平台歌单页会按平台显示“账号目录”或“公开链接导入”，并显示具体原因；导入目标始终是新的本机歌单，不会写入澜音“云端歌单”。播放仍取决于对应音源插件和平台会员权限。
- 原生登录新增保存酷我 `Hm_Iuvt_...` 和酷狗 `kg_mid`。升级前保存的旧酷我会话需要重新登录一次，才能取得公开歌单所需签名 Cookie。

## WebDAV 双向同步与删除

- 保留三方比较和强 ETag 条件写入；412 重读重试一次，连续 412 安全失败。
- 快照升级为 v2：新增歌单、歌单曲目、收藏三类 `tombstones`，保留完整可移植副本、删除时间、设备标识和所属歌单；仍可读取 v1 并在首次同步/手动备份时无损重写为 v2。
- 只有另一侧自上次成功基线未修改时才传播删除；删除撞上编辑时保留编辑内容作为冲突副本并报告，不静默删除。
- 双方删除同一项时只保留第一次删除归属；恢复删除记录后，下次同步会重新发布并清除远端 tombstone。同步后撤销恢复会返回 `STALE`，不写回过期基线。
- 同步状态显示删除总数及歌单/曲目/收藏分类；同步结果包含远端删除计数和删除冲突。手动备份会携带当前删除记录。
- 曲目删除、跨歌单移动、同 ID 私有引用、损坏基线和连接移除后的孤儿状态均有保守处理；本地基线损坏会安全失败，不静默降级为无基线合并。
- 自动同步改为应用级调度：离开同步服务页后仍会按连接的 1–60 分钟间隔检查；同一设备只允许一个自动同步目标。Android 增加 `dataSync` 前台保活壳，服务随任务移除停止。
- 自动同步仍不是 WorkManager 定时任务：Android 可能暂停 WebView 或限制后台执行，保活壳只提高进程存活概率，不承诺锁屏/被系统冻结时必然运行。
- 限制：tombstone 暂无自动过期/清理；受 5 MiB 同步文件和 8 MiB 备份上限约束。手动“替换恢复”可能让缺失项在后续同步被当作删除传播，界面已警告。

## WebDAV 音乐库

- 同步服务页新增“打开 WebDAV 音乐库”入口；可选择已确认连接、填写专用目录内相对路径，并按 1–5 层逐级扫描。
- 扫描只发送 `PROPFIND Depth: 1`，解析 `displayname` / `href` / `getcontentlength` / `getlastmodified` / `getcontenttype`，过滤常见音频扩展名；目录、响应和 href 都限制在已确认 origin / basePath 内，拒绝 `..`、绝对路径、双编码、跨 origin、越界 href 和重定向。
- 远端曲目使用 `providerId: 'webdav'`、`pluginId: 'webdav'`，稳定身份由连接 ID 与相对路径组成；可预览、试听、筛选、全选，并原子添加到新建或已有本机歌单，支持撤销。
- 播放时从 secureStore 读取 Basic Authorization；歌单只保存 `connectionId`、`path`、`displayName`、大小和修改时间，不保存密码、Authorization 或音频文件。
- 限制：带 Authorization 的音频沿用 `fetchWithHeaders`，会先完整下载为 blob 再播放，不是 Range 边下边播；大文件需要等待，下载完成前不能拖动进度。当前不解析 ID3/FLAC 内嵌标签、时长或封面，标题来自文件名，歌手指向父目录；扫描上限为 5 MiB 目录响应、500 个目录、5000 首音频。

## 平板与动效

- 768px 以上继续使用居中宽画布、悬浮底栏、多列页面、设置双栏和横屏播放器布局；手机布局保持不变。
- 合入搜索入口与底部 Sheet 动效修订：搜索页转场结束后再聚焦输入框，避免动画期间弹出键盘；确认/选项 Sheet 使用更稳定的进入退出过渡。

## 验证

- `node scripts/test-platform-playlists.mjs`：57/57 通过。真实公开数据覆盖网易云 110 首、QQ 公开账号 49 个目录和 15 首详情、酷我 42 首、咪咕 100 首；酷狗 10/69 残缺响应被明确拒绝。另有请求头、签名、导入顺序和 UI 静态检查。
- `node scripts/test-sync-two-way.mjs`：133/133 通过，覆盖双向同步、冲突副本、412 重试、删除传播、删除撞编辑、双方删除、第三客户端、歌单/曲目/收藏 tombstone、恢复、v1 迁移和失败回滚。
- `node scripts/test-sync-webdav.mjs`：47/47 通过；`node scripts/test-library-snapshot.mjs`：23/23 通过。
- `node scripts/test-webdav-media.mjs`：64/64 通过，包含真实本机 HTTP WebDAV PROPFIND/GET、Depth 1–5、越界拒绝、导入顺序、播放 Authorization 和缺失凭据。
- `node scripts/test-auto-sync.mjs`：13/13 通过；`node scripts/test-sync-ui.mjs`：24/24 通过；`node scripts/test-platform-accounts.mjs`：16/16 通过。
- 搜索入口 / Sheet 动效、搜索联想和 UI 竞态测试通过；`node scripts/test-tablet-layout.mjs`：287/287 通过；`npx vue-tsc --noEmit`、`npm run build` 通过。

versionName 2.6.26，versionCode 24044；保留原签名。没有 Android 真机、真实网易云/QQ/酷我/咪咕账号或真实 NAS 验证；验证码、风控、短信、CapacitorHttp Cookie 投递、会员播放权限和 Android 后台限制仍需实机确认。

## 仍未完成 / 未验证

- 酷狗完整歌单、酷我账号目录、咪咕账号目录、汽水歌单未接入；QQ 私密/隐藏歌单、微信登录 UIN 未验证。
- WebDAV 音频为整文件下载后播放，不是 Range 流式；真实 NAS、CORS、证书和 Android 真机仍需验证。
- 自动同步在应用进程存活时按间隔运行；系统冻结 WebView、强制停止应用或移除任务后不保证继续同步。
- tombstone 无自动清理；长期大量删除会占用快照空间，受同步大小限制。

APK SHA-256：d9fe25d377e57567b9f0641ddb1977522e367be17125e1956fdb48acd253e70b

APK 大小：7596667 字节
