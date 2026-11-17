<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { confirmAction } from '@/core/confirm'
import { clearThemeBackground, restoreThemeBackground, replaceThemeBackground, themeBackgroundState, updateThemeBackground, type ThemeBackgroundConfig } from '@/core/themeBackground'

defineOptions({ name: 'ThemeBackgroundSettings' })
const router = useRouter()
const message = ref('')
const config = computed(() => themeBackgroundState.config)
const preview = computed(() => config.value?.kind === 'video' ? themeBackgroundState.posterUrl : themeBackgroundState.url)
const previewStyle = computed(() => ({ objectFit: config.value?.fit ?? 'cover', filter: `blur(${config.value?.blur ?? 0}px)` }))
const error = computed(() => themeBackgroundState.error)
onMounted(() => { void restoreThemeBackground() })

async function choose(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  message.value = ''
  try { await replaceThemeBackground(file); message.value = '背景已验证并保存到本机，重新打开后仍可使用。' }
  catch { /* Shared state reports the concrete decode/storage failure. */ }
}

async function save(field: 'mask' | 'blur' | 'dark' | 'fit' | 'scope' | 'motion', event: Event): Promise<void> {
  const input = event.target as HTMLInputElement | HTMLSelectElement
  const previous = config.value?.[field]
  const value = field === 'mask' || field === 'blur' ? Number(input.value) : field === 'dark' ? input.value === 'true' : input.value
  message.value = ''
  try { await updateThemeBackground({ [field]: value } as Partial<ThemeBackgroundConfig>); message.value = '背景设置已保存' }
  catch { input.value = String(previous ?? '') }
}

async function clear(): Promise<void> {
  if (!await confirmAction({ title: '恢复默认背景？', body: '只清除本机保存的主题素材和样式，不删除你选择的原文件、歌单或下载。', confirmText: '恢复默认' })) return
  message.value = ''
  try { await clearThemeBackground(); message.value = '已恢复默认背景；播放器继续使用原歌曲封面。' }
  catch { /* Keep the existing background on failed persistence. */ }
}
</script>

<template>
  <div class="screen theme-background-settings">
    <div class="appbar">
      <button class="iconbtn quiet" aria-label="返回" @click="router.back()"><Icon name="chevron-left" :size="22" /></button>
      <h1 class="appbar-title">图片与视频背景</h1><span class="appbar-hold" />
    </div>
    <div class="scroll theme-body">
      <div class="theme-preview" :class="{ empty: !preview }" aria-label="背景静态预览">
        <img v-if="preview" :src="preview" :style="previewStyle" alt="已验证的背景首帧预览" />
        <div v-if="preview" class="preview-mask" :style="{ background: config?.dark ? '#000' : '#fff', opacity: config?.mask ?? 0.6 }" />
        <div class="preview-copy" :class="{ dark: config?.dark }"><strong>{{ preview ? '背景预览' : '默认背景' }}</strong><span>{{ preview ? '视频只预览首帧，不开启第二个播放器' : '未启用自定义背景，保留白底与歌曲封面' }}</span></div>
      </div>
      <p v-if="config" class="theme-file">{{ config.name }} · {{ config.kind === 'video' ? '视频' : '图片' }} · {{ (config.size / 1024 / 1024).toFixed(1) }} MB · {{ config.width }}×{{ config.height }}</p>
      <label class="theme-file-picker">
        <Icon name="folder" :size="19" /> {{ themeBackgroundState.saving ? '正在验证并保存…' : '选择图片或视频' }}
        <input type="file" aria-label="选择图片或视频背景" :disabled="themeBackgroundState.saving || themeBackgroundState.probing" @change="choose" />
      </label>
      <p class="theme-hint">不按扩展名限制选择。文件须通过内容、真实首帧、设备解码和存储检查；最多 256 MB / 3200 万像素。SVG 不支持；GIF 保存静态首帧（最长边 1280px）。动态背景请用视频，优先 MP4/H.264，其他编码按设备实际支持。</p>
      <p v-if="error" class="theme-error" role="alert">{{ error }}</p>
      <p v-if="message" class="theme-message" role="status">{{ message }}</p>
      <div v-if="config" class="theme-options">
        <label for="theme-scope">作用范围<select id="theme-scope" :value="config.scope" :disabled="themeBackgroundState.saving" @change="save('scope', $event)"><option value="main">首页等主页面（保留播放器歌曲封面）</option><option value="player">播放器与完整歌词</option><option value="lyrics">仅完整歌词</option><option value="all">全应用（明确覆盖播放器背景）</option></select></label>
        <label for="theme-mask">遮罩强度 <b>{{ Math.round(config.mask * 100) }}%</b><input id="theme-mask" type="range" min="0" max="0.95" step="0.05" :value="config.mask" :disabled="themeBackgroundState.saving" @change="save('mask', $event)" /></label>
        <label for="theme-blur">背景模糊 <b>{{ config.blur }} px</b><input id="theme-blur" type="range" min="0" max="30" step="1" :value="config.blur" :disabled="themeBackgroundState.saving" @change="save('blur', $event)" /></label>
        <label for="theme-dark">遮罩颜色<select id="theme-dark" :value="String(config.dark)" :disabled="themeBackgroundState.saving" @change="save('dark', $event)"><option value="false">浅色（便于深色文字阅读）</option><option value="true">暗色（不改变系统主题）</option></select></label>
        <label for="theme-fit">填充方式<select id="theme-fit" :value="config.fit" :disabled="themeBackgroundState.saving" @change="save('fit', $event)"><option value="cover">填满（可能裁切）</option><option value="contain">完整显示（可能留边）</option></select></label>
        <label v-if="config.kind === 'video'" for="theme-motion">视频动态<select id="theme-motion" :value="config.motion" :disabled="themeBackgroundState.saving" @change="save('motion', $event)"><option value="auto">前台静音循环；减少动态/省流时用首帧</option><option value="poster">始终使用静态首帧</option></select></label>
      </div>
      <button v-if="config" class="btn btn-ghost theme-clear" :disabled="themeBackgroundState.saving" @click="clear">恢复默认 / 清除背景</button>
      <button v-if="error && !config" class="btn btn-ghost theme-clear" :disabled="themeBackgroundState.saving || themeBackgroundState.probing" @click="restoreThemeBackground(true)">重新读取已保存背景</button>
      <p class="theme-hint theme-bottom">素材仅保存在本机，不随歌单同步，不读取整个媒体目录。视频始终静音，不使用音乐播放会话；后台、锁屏、离开作用范围时暂停。设备不支持时显示具体错误，保留上一背景。</p>
    </div>
  </div>
</template>

<style scoped>
.theme-background-settings .appbar { flex: none; height: calc(52px + var(--safe-top)); padding-top: var(--safe-top); background: var(--surface, var(--porcelain)); }
.appbar-title { flex: 1; margin: 0; font-size: 16px; text-align: center; }
.appbar-hold { width: 40px; flex: none; }
.theme-body { position: relative; inset: auto; flex: 1; min-height: 0; padding: 8px var(--pad) calc(var(--dock-h, 0px) + 24px + var(--safe-bottom)); }
.theme-preview { position: relative; width: 100%; height: 220px; max-height: 35vh; max-height: 35dvh; border-radius: 18px; overflow: hidden; border: 1px solid var(--line); background: var(--porcelain-2); }
.theme-preview img, .preview-mask { position: absolute; inset: 0; width: 100%; height: 100%; }
.preview-copy { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; gap: 6px; padding: 18px; color: #17221e; }
.preview-copy.dark { color: #fff; }
.preview-copy strong { font-size: 22px; }
.preview-copy span { font-size: 11px; line-height: 1.6; }
.theme-file { margin: 10px 0; padding: 6px 9px; border-radius: 8px; background: var(--surface, var(--porcelain)); font-size: 11px; line-height: 1.6; color: var(--ink-3); overflow-wrap: anywhere; }
.theme-file-picker { position: relative; display: flex; justify-content: center; gap: 8px; margin: 14px 0 8px; padding: 14px; border: 1px dashed var(--tint); border-radius: var(--r-md); color: var(--tint); background: var(--surface, var(--porcelain)); cursor: pointer; }
.theme-file-picker input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
.theme-file-picker:focus-within { outline: 2px solid var(--tint); outline-offset: 3px; }
.theme-hint { margin: 8px 0 14px; padding: 8px 10px; border-radius: 8px; background: var(--surface, var(--porcelain)); font-size: 11px; color: var(--ink-3); line-height: 1.65; }
.theme-error, .theme-message { padding: 10px 12px; border-radius: var(--r-sm); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.theme-error { color: var(--cinnabar); background: var(--porcelain-2); border-left: 2px solid var(--cinnabar); }
.theme-message { color: var(--tint); background: var(--surface, var(--porcelain)); border-left: 2px solid var(--tint); }
.theme-options { padding: 2px 14px; margin: 14px 0; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface, var(--porcelain)); }
.theme-options label { display: block; padding: 13px 0; font-size: 12px; line-height: 1.55; border-bottom: 1px solid var(--line); }
.theme-options label:last-child { border-bottom: 0; }
.theme-options b { float: right; font-size: 11px; color: var(--ink-3); }
.theme-options input[type=range] { display: block; width: 100%; margin: 12px 0 0; accent-color: var(--tint); }
.theme-options select { display: block; width: 100%; margin-top: 7px; padding: 9px; color: var(--ink); background: var(--porcelain-2); border: 1px solid var(--line); border-radius: 8px; font-size: 11px; }
.theme-clear { width: 100%; justify-content: center; margin: 6px 0 12px; }
.theme-bottom { margin-bottom: 20px; }
@media(max-width: 360px) { .theme-preview { height: 185px; } .theme-options { padding: 2px 10px; } }
</style>
