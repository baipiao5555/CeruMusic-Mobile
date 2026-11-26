# v2.7.10 正式版

修复 OriginOS/iQOO 等系统无法在应用内更新 APK 的问题。

## 根因与修复

- 旧更新逻辑复用音乐下载器，把 APK 插入 `content://media/external/audio/media`；OriginOS 6 按 MIME 严格拒绝 APK。
- 新增更新包专用下载：写入应用私有 `ExternalFiles/Download/updates`，不进入音乐 MediaStore。
- 安装器支持绝对路径并继续使用 FileProvider 的 `application/vnd.android.package-archive` 类型。
- 下载进度、镜像切换、文件大小校验、取消和旧版本安装回退保留。

## 保留

- v2.7.9 的应用内 OAuth 登录回跳。
- 与其他应用同时播放开关和 WebView 后台保持。
- MusicFree 导入、歌单/榜单、A 音源市场、B 管理界面、本地扫描快照。

## 验证

- 更新下载路径契约测试通过：使用私有 Downloads + FileProvider，不再操作 MediaStore audio。
- Web 构建、Capacitor sync、Android Release 构建通过。
- APK 版本 `2.7.10 / 24083`，同签名；包内 Web 文件一致。
- 未连接实体 Android 设备；OriginOS 真机更新安装仍需用户测试。
- 注意：2.7.8/2.7.9 的自身更新会走旧逻辑，需先手动安装一次 2.7.10；之后应用内更新恢复。
