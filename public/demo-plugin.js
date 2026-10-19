exports.manifest = {
  manifestVersion: 2,
  id: 'ceru.mobile.demo',
  name: '示例音源',
  version: '1.0.0',
  description: '内置演示插件，用于验证搜索、播放与歌词链路',
  author: 'Ceru Music Mobile',
  engines: { hostApi: '^2.0.0', logicRuntime: 'ceru-js@1' },
  modules: { logic: { entry: 'logic.main' } },
  permissions: [
    {
      key: 'network',
      name: 'network.request',
      reason: '读取公开的示例音频与演示数据'
    }
  ],
  contributes: {
    providers: [
      {
        id: 'demo',
        name: '示例音源',
        protocols: ['https'],
        qualities: ['128k'],
        connectionMode: 'none'
      }
    ],
    homeSections: [
      {
        id: 'demo-charts',
        title: '示例榜单',
        kind: 'charts',
        providerIds: ['demo'],
        order: 10
      }
    ]
  }
}

exports.activate = function (core) {
  const TRACKS = [
    {
      id: 'demo-1',
      title: '夜的钢琴曲（演示）',
      artist: '示例音乐人',
      album: '演示专辑',
      durationMs: 188000,
      color: '#00b578'
    },
    {
      id: 'demo-2',
      title: 'City Lights（演示）',
      artist: 'Demo Artist',
      album: 'Mobile Sessions',
      durationMs: 206000,
      color: '#4f7cff'
    },
    {
      id: 'demo-3',
      title: '海边的风（演示）',
      artist: '示例乐队',
      album: '夏日海岸',
      durationMs: 174000,
      color: '#ff8a4c'
    },
    {
      id: 'demo-4',
      title: 'Midnight Drive（演示）',
      artist: 'Demo Artist',
      album: 'Mobile Sessions',
      durationMs: 221000,
      color: '#9b6bff'
    }
  ]

  const toTrack = (track) => ({
    ref: {
      providerId: 'demo',
      kind: 'track',
      id: track.id,
      scope: 'provider',
      data: { title: track.title, artist: track.artist }
    },
    title: track.title,
    subtitle: track.artist,
    capabilities: ['play'],
    extensions: { demoColor: track.color },
    metadata: {
      artists: [track.artist],
      album: { title: track.album },
      durationMs: track.durationMs,
      artworkUrl: '/default-cover.png',
      qualities: ['128k']
    }
  })

  const chartItem = {
    ref: {
      providerId: 'demo',
      kind: 'chart',
      id: 'demo-top',
      pluginId: core.plugin.id
    },
    title: '示例热歌榜',
    subtitle: '内置演示数据',
    capabilities: ['play'],
    chart: { updateFrequency: '每日更新' },
    extensions: { demoColor: '#00b578' }
  }

  core.providers.register('demo', {
    tracks: {
      search: async (request) => {
        const query = String(request.query || '').trim()
        if (!query) return { items: TRACKS.map(toTrack) }
        const query2 = query.toLowerCase()
        const matched = TRACKS.filter((track) =>
          `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(query2)
        )
        return { items: (matched.length ? matched : TRACKS).map(toTrack) }
      },
      resolve: async (resource) => {
        const index = Math.max(
          0,
          TRACKS.findIndex((track) => track.id === resource.id)
        )
        const urls = [
          'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
          'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
          'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
          'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3'
        ]
        return { ok: true, url: urls[index % urls.length] }
      },
      lyrics: async (resource) => {
        const title =
          TRACKS.find((track) => track.id === resource.id)?.title || '示例歌曲'
        return {
          format: 'crlyric',
          version: 1,
          track: resource,
          offsetMs: 0,
          lines: [
            { startTimeMs: 0, endTimeMs: 3000, text: title },
            { startTimeMs: 3000, endTimeMs: 6500, text: '这是澜音手机版的歌词演示' },
            { startTimeMs: 6500, endTimeMs: 10000, text: '插件运行在独立沙箱中' },
            { startTimeMs: 10000, endTimeMs: 14000, text: '搜索、播放与歌词来自同一个音源' },
            { startTimeMs: 14000, endTimeMs: 18000, text: '安装真实插件后即可使用你的音源' },
            { startTimeMs: 18000, endTimeMs: 28000, text: '♪' }
          ]
        }
      }
    },
    charts: {
      list: async () => {
        return { items: [chartItem] }
      },
      getTracks: async () => ({ items: TRACKS.map(toTrack) })
    }
  })
}
