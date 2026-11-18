# 澜音 v2.6.30 · 系统字体、在线音源分组与自动回退修正

本版继续修正播放器歌词、字体和在线音源选择体验。

## 修复

- 跟随系统字体现在同时应用到播放器两行歌词和全屏歌词，不再回退成歌词单独的衬线字体。
- 在线音源改为按插件归组：默认只显示音源（插件）名称，点击后才展开 QQ音乐、网易云、酷狗、酷我等平台 provider；默认不再铺一排「聚合/QQ音乐/…」卡片。
- 自动回退只选择同时支持搜索和播放地址解析的其他音源，避免切到只有搜索、没有 resolve 的 provider。
- 保留 v2.6.29 的歌词时钟、倍速同步、全屏歌词模糊和第三方 JSON 配置提示。

## 验证

- `node scripts/test-lyric-clock.mjs`：2 倍速、时钟不回退、当前行推进、预览不重挂载、系统字体和沉浸式模糊通过。
- `node scripts/test-source-groups.mjs`：音源名称默认收起，点击展开 provider，再次点击收起。
- `node scripts/test-plugin-import.mjs`：青听等第三方 JSON 配置被明确拒绝。
- 搜索、弹层、播放器封面和长列表回归通过。

## 发布产物

- APK：`D:\LX\CeruMusic-Mobile-v2.6.30.apk`
- 大小：`7568977` 字节
- SHA256：`84a31426a63af16bcbd640463c0a83be4cbbbafe445bd7754fe289be5c9b6688`

versionName 2.6.30，versionCode 24048；继续保留原签名。

