# 澜音 v2.6.31 · 页面转场与滚动卡顿优化

本版针对自定义主题背景下的页面切换卡顿、Tab 空帧和搜索/封面动画负担做轻量化。

## 修复

- Tab 切换保留旧页参与短交叉淡入，不再先移除旧页导致只剩背景的空帧。
- 页面前进/返回和搜索进入改为 opacity-only 短淡入，不再整页位移；时长压缩到约 0.18s。
- Tab 淡入约 0.12s，并增加 160ms 防连点，避免多个整页动画叠加造成重影。
- 自定义背景图层增加 paint containment / isolation，避免背景模糊层参与页面重排。
- 封面图改为原生 lazy loading + async decode，减少滚动和转场时的图片解码压力。
- 全屏歌词只对当前行附近 ±3 行应用模糊，其他行不创建模糊滤镜层。

## 验证

- `npm run build` 通过。
- `test-tab-motion.mjs`：旧页保留、无背景空帧。
- `test-lyric-clock.mjs`：倍速歌词推进、系统字体、全屏歌词模糊。
- `test-source-groups.mjs`：在线音源默认收起、点击展开。
- 搜索、弹层、播放器封面和长列表回归通过。

## 发布产物

- APK：`D:\LX\CeruMusic-Mobile-v2.6.31.apk`
- 大小：`7569084` 字节
- SHA256：`003c53d366fd9f89761f96bf54e71a0514556e8f3cb10fd377f72a922c551c6e`

versionName 2.6.31，versionCode 24049；继续保留原签名。

