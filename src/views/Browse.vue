<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SongRow from '@/components/SongRow.vue'
import { allProviders, invokeProvider } from '@/core/plugin/manager'
import { playTracks, toTrack, type Track } from '@/core/playback/player'
import { rememberTracks } from '@/core/search'

const route = useRoute()
const router = useRouter()

const providerId = String(route.query.provider ?? '')
const kind = String(route.query.kind ?? 'chart')
const id = String(route.query.id ?? '')
const title = String(route.query.title ?? '歌单')
const artwork = String(route.query.artwork ?? '/default-cover.png')

const tracks = ref<Track[]>([])
const loading = ref(true)
const error = ref('')
const cursor = ref<string | undefined>(undefined)
const loadingMore = ref(false)
const ended = ref(false)

const provider = computed(() => allProviders().find((item) => item.providerId === providerId))

const resourceRef = computed(() =>
  kind === 'track'
    ? { providerId, kind, id, scope: 'provider' as const }
    : { providerId, kind, id, pluginId: provider.value?.manifestId ?? '' }
)

/* —— 纯 UI 派生：类型名、来源名、空列表/真错误分流 —— */
const kindLabel = computed(() => {
  if (kind === 'playlist') return '歌单'
  if (kind === 'chart') return '榜单'
  if (kind === 'track') return '单曲'
  return kind || '内容'
})

const providerName = computed(() => provider.value?.name ?? provider.value?.pluginName ?? '音源未启用')

/** 音源回了「没有歌曲」= 中性空列表，不是报错。 */
const noTracks = computed(
  () => !loading.value && !tracks.value.length && error.value === '没有找到歌曲'
)

/** 真错误：音源没启用、类型不支持、请求抛错。 */
const failure = computed(
  () =>
    !loading.value &&
    !tracks.value.length &&
    Boolean(error.value) &&
    error.value !== '没有找到歌曲'
)

async function load(more = false): Promise<void> {
  const owner = provider.value
  if (!owner) {
    error.value = '音源插件未启用'
    loading.value = false
    return
  }
  if (more) {
    if (loadingMore.value || ended.value) return
    loadingMore.value = true
  } else {
    loading.value = true
    tracks.value = []
    cursor.value = undefined
    ended.value = false
  }
  error.value = ''
  try {
    let page: any
    if (kind === 'playlist') {
      page = await invokeProvider(owner, 'playlists.get', [resourceRef.value, cursor.value])
    } else if (kind === 'chart') {
      page = await invokeProvider(owner, 'charts.getTracks', [resourceRef.value, cursor.value])
    } else {
      throw new Error('不支持的内容类型')
    }
    const items = (page?.items ?? [])
      .filter((item: any) => item.ref?.kind === 'track')
      .map((item: any) => toTrack(item, owner))
    tracks.value = more ? [...tracks.value, ...items] : items
    cursor.value = page?.nextCursor
    ended.value = !cursor.value
    if (!tracks.value.length) error.value = '没有找到歌曲'
    // 榜单/歌单里的歌进本地索引，搜索页的即时联想才有词可用。
    rememberTracks(items)
  } catch (err: any) {
    error.value = err?.message ?? '加载失败'
  } finally {
    loading.value = false
    loadingMore.value = false
  }
}

function play(index: number): void {
  if (tracks.value.length) void playTracks(tracks.value, index)
}

function playAll(): void {
  if (tracks.value.length) void playTracks(tracks.value, 0)
}

onMounted(() => void load())
</script>

<template>
  <div class="screen browse-page">
    <div class="scroll safe-t-lg">
      <div class="appbar">
        <button class="iconbtn quiet" aria-label="返回" @click="router.back()">
          <Icon name="back" :size="20" />
        </button>
        <div class="ttl">
          浏览
          <span class="sub">{{ kindLabel }} · {{ providerName }}</span>
        </div>
        <button class="iconbtn quiet" aria-label="搜索" @click="router.push('/search')">
          <Icon name="search" :size="19" />
        </button>
      </div>

      <div class="pad">
        <div class="crumb">
          <span class="c-part">{{ providerName }}</span>
          <span class="c-sep">›</span>
          <span class="c-part">{{ kindLabel }}</span>
          <span class="c-sep">›</span>
          <span class="c-now">{{ title }}</span>
        </div>
      </div>

      <div class="page-head mt16">
          <div class="f1 headmain">
            <span class="cover hdcover">
              <img
                :src="artwork"
                alt=""
                @error="($event.target as HTMLImageElement).src = '/default-cover.png'"
              />
            </span>
            <div class="f1">
              <h1 class="clamp-2">{{ title }}</h1>
              <div class="sub">
                {{ tracks.length }} 首<template v-if="tracks.length"> · {{ ended ? '已全部加载' : '可继续加载' }}</template>
              </div>
            </div>
          </div>
          <div class="page-actions">
            <button class="btn btn-primary btn-sm" :disabled="!tracks.length" @click="playAll">
              <Icon name="play" :size="13" /> 播放全部
            </button>
          </div>
        </div>

      <div v-if="loading" class="pad mt20" aria-live="polite">
        <div v-for="row in 6" :key="row" class="skelrow">
          <span class="skeleton skelidx" />
          <span class="skeleton skelcov" />
          <span class="skellines">
            <span class="skeleton skelt" />
            <span class="skeleton skela" />
          </span>
        </div>
        <p class="meta mt12">正在从「{{ providerName }}」取「{{ title }}」…</p>
      </div>

      <div v-else-if="failure" class="empty">
        <div class="glyph"><Icon name="warning" :size="34" /></div>
        <h3>没能打开这个{{ kindLabel }}</h3>
        <p>{{ error }}</p>
        <div class="row g8 mt8">
          <button class="btn btn-ghost btn-sm" @click="router.back()">返回</button>
          <button class="btn btn-primary btn-sm" @click="load()">重试</button>
        </div>
      </div>

      <template v-else>
        <div class="group-title">
          <span class="cn">曲目</span>
          <span class="cnt">{{ tracks.length }}</span>
          <span class="en">Tracks</span>
        </div>

        <div class="pad mt10">
          <div class="listcard">
            <button class="folderrow" @click="router.back()">
              <span class="ftile"><Icon name="folder" :size="20" /></span>
              <span class="fbody">
                <span class="nm">返回上级</span>
                <span class="mt">{{ providerName }} · {{ kindLabel }}</span>
              </span>
              <Icon name="chevron" :size="16" class="ftrail" />
            </button>

            <div v-if="tracks.length" class="rows">
              <SongRow
                v-for="(track, index) in tracks"
                :key="track.providerId + track.id + index"
                :track="track"
                :index="index"
                :queue="tracks"
                show-index
                @play="play(index)"
              />
            </div>
          </div>
        </div>

        <div v-if="noTracks" class="empty">
          <div class="glyph"><Icon name="folder" :size="34" /></div>
          <h3>这个{{ kindLabel }}还没有曲目</h3>
          <p>音源没有返回内容。可以换一个音源，或回到发现页挑别的{{ kindLabel }}。</p>
          <div class="row g8 mt8">
            <button class="btn btn-ghost btn-sm" @click="router.push('/')">回发现页</button>
            <button class="btn btn-tint btn-sm" @click="load()">重新加载</button>
          </div>
        </div>

        <div class="pad mt16">
          <button
            v-if="!ended && tracks.length"
            class="btn btn-ghost btn-block"
            :disabled="loadingMore"
            @click="load(true)"
          >
            <span v-if="loadingMore" class="loading-dots"><i /><i /><i /></span>
            <template v-else>加载更多</template>
          </button>
          <p v-else-if="tracks.length" class="meta tc mt8">已经到底了 · {{ tracks.length }} 首</p>
        </div>

      </template>
    </div>
  </div>
</template>

<style scoped>
.crumb {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  max-width: 100%;
  min-height: 30px;
  padding: 0 11px;
  border-radius: var(--r-pill);
  background: var(--surface);
  border: 1px solid var(--line);
  font-size: 11.5px;
  color: var(--ink-4);
}
.c-part {
  flex: none;
}
.c-sep {
  flex: none;
  color: var(--ink-4);
}
.c-now {
  min-width: 0;
  color: var(--ink-2);
  font-weight: 550;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.listcard {
  padding: 2px 8px;
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--sh-2);
}
.folderrow {
  display: flex;
  align-items: center;
  gap: 13px;
  width: 100%;
  min-height: 60px;
  text-align: left;
  border-bottom: 1px solid var(--line);
}
.ftile {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: 13px;
  color: var(--ink-3);
  background: var(--porcelain-2);
}
.fbody {
  flex: 1;
  min-width: 0;
}
.fbody .nm {
  display: block;
  font-size: 14.5px;
  font-weight: 550;
  color: var(--ink);
}
.fbody .mt {
  display: block;
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--ink-4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ftrail {
  flex: none;
  color: var(--ink-4);
}
.rows {
  padding-top: 2px;
}
.skelrow {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 60px;
  padding: 0 4px;
}
.skelidx {
  width: 20px;
  height: 10px;
  flex: none;
  border-radius: 3px;
}
.skelcov {
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: var(--r-sm);
}
.skellines {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
}
.skelt {
  display: block;
  height: 11px;
  width: 58%;
  border-radius: 4px;
}
.skela {
  display: block;
  height: 9px;
  width: 34%;
  border-radius: 4px;
}
.artnote {
  color: var(--ink-4);
  word-break: break-all;
  padding-bottom: 4px;
}
.headmain {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.hdcover {
  width: 54px;
  height: 54px;
  flex: none;
  border-radius: var(--r-md);
}

</style>
