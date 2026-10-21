# 跟随桌面版更新

手机版是 [timeshiftsauce/CeruMusic](https://github.com/timeshiftsauce/CeruMusic) 的 Capacitor 移植，
不是 fork：桌面版是 Electron + Vue + Rust 原生模块，手机版是 Capacitor + Vue + Java 原生插件，
只有渲染层（Vue 页面、store、api、utils）和插件协议部分可以直接参考。

`package.json` 里的 `upstreamVersion` 记录当前移植到桌面版的哪个版本。

## 一条命令看有没有新版本

```bash
npm run check:upstream
```

它会同时查三个地方：

1. 桌面版官方更新源 `update.cerumusic.top`（和桌面客户端自动更新用的是同一个接口）
2. GitHub 最新 Release
3. 本地桌面源码 `D:/LX/CeruMusic-src` 中 `v<upstreamVersion>..origin/main` 的新提交与变更文件

可用 `CERU_UPSTREAM_DIR` 指定别的源码目录。

## 有更新时的移植清单

1. **更新桌面源码**

   ```bash
   git -C D:/LX/CeruMusic-src fetch origin --tags
   git -C D:/LX/CeruMusic-src checkout v<新版本>
   ```

2. **先看有没有插件协议变化**（优先级最高，影响所有音源插件）

   - `src/common/api/*`、`src/renderer/src/services/pluginHostServices.ts`
   - `docs/guide/plugins/v2/host-services.md`、`reference.md`
   - `package.json` 里 `@shiqianjiang/ceru-plugin-*` 的版本
   - 对应手机版：`src/core/plugin/host.ts`、`manager.ts`、`src/core/downloadHost.ts`
   - SDK 升级时同步升级手机版依赖，并重跑 `scripts/test-real-plugin.mjs`

3. **再移植业务功能**（按用户能感知的优先级）

   | 桌面版 | 手机版对应位置 |
   | --- | --- |
   | `src/renderer/src/api/*`（云歌单、设置同步、分享） | `src/core/cloud.ts`、`src/core/auth.ts` |
   | `src/renderer/src/store/LocalUserDetail.ts`、歌单逻辑 | `src/core/library.ts` |
   | `src/renderer/src/utils/audio/download.ts`、`DownloadManager` | `src/core/downloads.ts`、`DownloaderPlugin.java` |
   | `src/renderer/src/utils/lyrics/*`、云歌词 | `src/core/lyrics/cloud.ts` |
   | `src/renderer/src/views/music/*` | `src/views/*` |
   | 新设置项 | `src/core/settings.ts` + `src/views/Settings.vue` |

4. **不要移植的部分**

   - Electron 主进程、自动更新、窗口/托盘、DLNA、本地音乐扫描与标签编辑
   - Rust 原生模块（媒体控制、音频后端）；手机版用 Android 前台媒体服务代替
   - 插件 Web/Native Surface 页面；手机版只把插件当音源

5. **安全约束不能回退**

   - 所有服务端请求只允许 `http`/`https`，并拒绝 localhost、回环、私有、保留地址
   - 插件请求走 `src/core/plugin/network.ts`，原生下载器对每一跳重定向重新校验
   - 插件代码只在 iframe 沙箱里执行

6. **改版本号与字段**

   - 上游 `2.3.1 → 2.4.0` 时，手机版改为 `2.4.0-mobile.1`
   - 只修手机版自己的问题继续用 `2.3.1-mobile.N`
   - 更新 `package.json` 的 `upstreamVersion` 和 `version`

7. **验证**

   ```bash
   npx vue-tsc --noEmit
   npm run build
   node scripts/test-mobile-15.mjs      # 搜索/下载/账号页/设置
   node scripts/test-cloud-lyrics.mjs   # 云歌词
   ```

8. **发版**

   ```bash
   npm run release
   ```

   发版脚本会自动：递增版本号与 versionCode → 构建 Web 与 APK → 校验签名 → 生成 SHA-256 →
   清理构建产物 → 提交、打 tag、推送 → 创建 GitHub Release。

## 发版说明里的占位符

`docs/release-v<版本>.md` 可以使用两个占位符，发版脚本会替换成真实值：

- `<!-- SHA256 -->` → APK 的 SHA-256
- `<!-- SIZE -->` → APK 的字节数
