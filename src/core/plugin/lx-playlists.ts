import { requestRemote, validateRemoteUrl } from './network'
import { LX_SOURCE_NAMES, mapLxSong } from './lx-catalog'

// Public playlist directories are host adapters; LX scripts still resolve audio.
export const LX_PLAYLIST_SOURCES = ['kw', 'kg', 'tx', 'wy', 'mg']
const headersFor = (source: string) => ({ Referer: ({kw:'https://www.kuwo.cn/',kg:'https://www.kugou.com/',tx:'https://y.qq.com/',wy:'https://music.163.com/',mg:'https://m.music.migu.cn/'} as Record<string,string>)[source] })
const clean = (value: any) => String(value ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim()
function cover(value: any): string | undefined {
  if (!value || typeof value !== 'string') return undefined
  try {
    const url = validateRemoteUrl(value.replace(/^http:/i,'https:').replace(/\{size\}/g,'480'))
    url.hostname = url.hostname.replace(/^(img\d+)\.(?:kwcdn|sycdn)\.kuwo\.cn$/i,'$1.kuwo.cn')
    return url.href
  } catch { return undefined }
}
async function request(source: string, url: string, signal?: AbortSignal, raw = false): Promise<any> {
  const response = await requestRemote({url, headers:headersFor(source), timeoutMs:15_000, signal, raw})
  if (response.status < 200 || response.status >= 300) throw new Error(`${LX_SOURCE_NAMES[source]}歌单接口：HTTP ${response.status}`)
  if (!raw && (!response.body || typeof response.body !== 'object')) throw new Error(`${LX_SOURCE_NAMES[source]}歌单接口返回了无效数据`)
  return response.body
}
const qqUrl = (module: string, method: string, param: any) => 'https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data='+encodeURIComponent(JSON.stringify({comm:{ct:20,cv:1602},playlist:{module,method,param}}))
function category(source: string, id: any, name: any): any {
  return {ref:{providerId:source,kind:'playlist-category',id:String(id),scope:'provider'},title:clean(name)}
}
function playlist(source: string, id: any, title: any, artwork: any, count?: any, author?: any): any {
  return {ref:{providerId:source,kind:'playlist',id:String(id),scope:'provider'},title:clean(title),metadata:{artworkUrl:cover(artwork)},playlist:{name:clean(title),artworkUrl:cover(artwork),trackCount:count != null && Number.isFinite(Number(count)) ? Number(count) : undefined,author:clean(author)}}
}
const validId = (value: string) => /^\d{1,20}$/.test(value)
function publicSongArray(html: string): any[] {
  const start = /(?:var\s+data|global\.data)\s*=\s*\[/.exec(html)
  if (!start) throw new Error('酷狗公开歌单页面格式变化；该链接暂不能导入')
  const offset = start.index + start[0].length - 1
  let depth = 0, quoted = false, escaped = false
  for (let i = offset; i < html.length; i++) {
    const c = html[i]
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; continue }
    if (c === '"') quoted = true
    else if (c === '[') depth++
    else if (c === ']' && --depth === 0) return JSON.parse(html.slice(offset,i+1))
  }
  throw new Error('酷狗歌单歌曲数据不完整')
}

/** Parse only the selected platform's canonical public playlist links (or its ID). */
export function parseLxPlaylistInput(source: string, input: string): string {
  if (!LX_PLAYLIST_SOURCES.includes(source)) throw new Error('不支持该平台歌单')
  const text = input.trim()
  if (validId(text)) return text
  const match = text.match(/https?:\/\/[^\s<>"，。]+/i)
  if (!match) throw new Error('请粘贴公开歌单链接或歌单 ID')
  const url = validateRemoteUrl(match[0])
  const hosts: Record<string,string[]> = {kw:['www.kuwo.cn','kuwo.cn','m.kuwo.cn','h5app.kuwo.cn'],kg:['www.kugou.com','m.kugou.com'],tx:['y.qq.com','i.y.qq.com','c.y.qq.com'],wy:['music.163.com','y.music.163.com'],mg:['music.migu.cn','m.music.migu.cn','h5.nf.migu.cn']}
  if (!hosts[source].includes(url.hostname)) throw new Error(`请使用${LX_SOURCE_NAMES[source]}的公开歌单链接，不要使用歌曲链接或其他平台链接`)
  const path = url.pathname + url.hash
  let id: string | undefined
  if (source === 'kw') id = path.match(/\/playlist(?:_detail)?\/(\d+)/)?.[1]
  if (source === 'kg') id = path.match(/\/special\/single\/(\d+)\.html/)?.[1] || path.match(/\/plist\/list\/(\d+)/)?.[1]
  if (source === 'tx' && /\/(?:playlist|taoge)(?:\/|\.html|\?)/.test(path)) id = path.match(/\/playlist\/(\d+)/)?.[1] || url.searchParams.get('id') || url.searchParams.get('disstid') || undefined
  if (source === 'wy' && /\/playlist(?:\/|\?|$)/.test(path)) id = path.match(/\/playlist\/(\d+)/)?.[1] || new URLSearchParams(url.hash.split('?')[1] || url.search).get('id') || undefined
  if (source === 'mg' && /\/playlist(?:\/|\?|$)/.test(path)) id = path.match(/\/playlist\/(\d+)/)?.[1] || new URLSearchParams(url.hash.split('?')[1] || url.search).get('playlistId') || url.searchParams.get('id') || undefined
  if (!id || !validId(id)) throw new Error('无法识别歌单 ID；请使用完整公开歌单链接，短链接请先在浏览器打开后复制地址')
  return id
}

export function lxPlaylistImporters(providers: any[]): any[] {
  return providers.filter(p => LX_PLAYLIST_SOURCES.includes(p.id)).map(p => ({id:'lx-playlist-'+p.id,providerId:p.id,title:p.name+'歌单',description:'导入公开歌单，保留当前插件的平台来源',placeholder:'粘贴 '+p.name+' 公开歌单链接或 ID',instructions:['使用公开歌单的完整链接或歌单 ID；私密歌单需要先在原平台公开。','短链接请在浏览器打开后，复制完整歌单地址。'],examples:[]}))
}

export async function listLxPlaylistCategories(source: string, signal?: AbortSignal): Promise<any> {
  const first = category(source,'recommend','推荐歌单')
  let entries: any[] = []
  try {
    if (source === 'kw') {
      const data = await request(source,'http://wapi.kuwo.cn/api/pc/classify/playlist/getTagList?cmd=rcm_keyword_playlist&user=0&prod=kwplayer_pc_9.0.5.0',signal)
      if (!Array.isArray(data.data)) throw new Error('分类数据格式变化')
      entries = data.data.flatMap((g:any) => g.data || []).filter((x:any) => String(x.digest)==='10000').map((x:any)=>category(source,x.id,x.name))
    } else if (source === 'kg') {
      const data = await request(source,'http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?is_smarty=1&',signal)
      if (data.status !== 1 || !data.data?.tagids) throw new Error('分类数据格式变化')
      entries = Object.values(data.data.tagids).flatMap((g:any)=>g.data || []).map((x:any)=>category(source,x.id,x.name))
    } else if (source === 'tx') {
      const data = await request(source,qqUrl('playlist.PlaylistAllCategoriesServer','get_all_categories',{qq:''}),signal)
      if (!Array.isArray(data.playlist?.data?.v_group)) throw new Error('分类数据格式变化')
      entries = data.playlist.data.v_group.flatMap((g:any)=>g.v_item || []).map((x:any)=>category(source,x.id,x.name))
    } else if (source === 'wy') {
      const data = await request(source,'https://music.163.com/api/playlist/catalogue',signal)
      if (!Array.isArray(data.sub)) throw new Error('分类数据格式变化')
      entries = data.sub.map((x:any)=>category(source,x.name,x.name))
    } else if (source === 'mg') {
      const data = await request(source,'https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-taglist/release',signal)
      if (!Array.isArray(data.data)) throw new Error('分类数据格式变化')
      entries = data.data.flatMap((g:any)=>g.content || []).filter((x:any)=>x.texts?.length>=2).map((x:any)=>category(source,x.texts[1],x.texts[0]))
    } else throw new Error('不支持该平台歌单')
    return {items:[first,...entries.filter((e,i,a)=>e.title && a.findIndex(x=>x.ref.id===e.ref.id)===i)].slice(0,100)}
  } catch (error: any) {
    if (signal?.aborted) throw error
    // A taxonomy outage must not prevent the independent recommendation request.
    return {items:[first],warning:'歌单分类加载失败，仍可查看推荐歌单：'+error.message}
  }
}

export async function listLxPlaylists(source: string, ref: any, cursor?: string, signal?: AbortSignal): Promise<any> {
  const page = Math.max(1,Math.min(50,Number(cursor)||1)), limit = 30
  const id = String(ref?.id || 'recommend'), recommended = id === 'recommend'
  if (!recommended && (source === 'wy' ? id.length > 64 : !validId(id))) throw new Error('无效歌单分类')
  let items: any[] = [], total: number | undefined
  if (source === 'kw') {
    const url = 'http://wapi.kuwo.cn/api/pc/classify/playlist/'+(recommended?'getRcmPlayList':'getTagPlayList')+'?'+new URLSearchParams({loginUid:'0',loginSid:'0',appUid:'76039576',pn:String(page),rn:String(limit),...(recommended?{order:'hot'}:{id})})
    const data = await request(source,url,signal)
    if (data.code !== 200 || !Array.isArray(data.data?.data)) throw new Error('酷我推荐歌单加载失败')
    items = data.data.data.filter((r:any)=>String(r.digest)==='8').map((r:any)=>playlist(source,r.id,r.name,r.img,r.total,r.uname));total=Number(data.data.total)
  } else if (source === 'kg') {
    const data=await request(source,'http://www2.kugou.kugou.com/yueku/v9/special/getSpecial?'+new URLSearchParams({is_ajax:'1',cdn:'cdn',t:'5',c:recommended?'':id,p:String(page)}),signal)
    if(data.status!==1 || !Array.isArray(data.special_db)) throw new Error('酷狗推荐歌单加载失败')
    items=data.special_db.map((r:any)=>playlist(source,r.specialid,r.specialname,r.img||r.imgurl,r.songcount,r.nickname))
  } else if (source === 'tx') {
    const data=await request(source,recommended?qqUrl('music.playlist.PlaylistSquare','GetRecommendWhole',{IsReqFeed:true,FeedReq:{From:(page-1)*limit,Size:limit}}):qqUrl('playlist.PlayListCategoryServer','get_category_content',{titleid:Number(id),caller:'0',category_id:Number(id),size:limit,page:page-1,use_page:1}),signal)
    const rows=recommended?data.playlist?.data?.FeedRsp?.List?.map((r:any)=>r.Playlist):data.playlist?.data?.content?.v_item
    if(data.playlist?.code!==0 || !Array.isArray(rows)) throw new Error('QQ 推荐歌单加载失败')
    items=rows.filter((r:any)=>r?.basic).map((r:any)=>playlist(source,r.basic.tid,r.basic.title,r.basic.cover?.medium_url||r.basic.cover?.default_url,r.basic.song_cnt,r.basic.creator?.nick))
  } else if (source === 'wy') {
    const data=await request(source,'https://music.163.com/api/playlist/list?'+new URLSearchParams({cat:recommended?'全部':id,order:'hot',limit:String(limit),offset:String((page-1)*limit)}),signal)
    if(data.code!==200 || !Array.isArray(data.playlists)) throw new Error('网易云推荐歌单加载失败')
    items=data.playlists.map((r:any)=>playlist(source,r.id,r.name,r.coverImgUrl,r.trackCount,r.creator?.nickname));total=Number(data.total)
  } else if (source === 'mg') {
    const url=recommended?'https://app.c.nf.migu.cn/pc/bmw/page-data/playlist-square-recommend/v1.0?templateVersion=2&pageNo='+page:'https://app.c.nf.migu.cn/pc/v1.0/template/musiclistplaza-listbytag/release?'+new URLSearchParams({pageNumber:String(page),templateVersion:'2',tagId:id})
    const data=await request(source,url,signal)
    if(data.code!=='000000' || !data.data) throw new Error('咪咕推荐歌单加载失败')
    const walk=(rows:any[],depth=0):void=>{if(depth>8)return;for(const r of rows){if(Array.isArray(r.contents))walk(r.contents,depth+1);else if(String(r.resType)==='2021')items.push(playlist(source,r.resId,r.txt,r.img,undefined,r.txt2))}}
    if(Array.isArray(data.data.contents))walk(data.data.contents)
    else items=(data.data.contentItemList?.[1]?.itemList||[]).map((r:any)=>playlist(source,r.logEvent?.contentId,r.title,r.imageUrl))
  } else throw new Error('不支持该平台歌单')
  items=items.filter((r,i,a)=>validId(r.ref.id)&&r.title&&a.findIndex(x=>x.ref.id===r.ref.id)===i)
  return {items,nextCursor:items.length && (Number.isFinite(total)?page*limit<total!:items.length>=limit)?String(page+1):undefined}
}

export async function getLxPlaylist(source: string, ref: any, cursor?: string, requestedLimit=100, signal?: AbortSignal): Promise<any> {
  const id=String(ref?.id || '');if(!validId(id)) throw new Error('无效歌单 ID')
  const page=Math.max(1,Math.min(50,Number(cursor)||1)),limit=Math.max(1,Math.min(100,requestedLimit))
  let rows:any[]=[],total=0,name='';let sliced=false
  if(source==='kw') {
    const data=await request(source,'http://nplserver.kuwo.cn/pl.svc?'+new URLSearchParams({op:'getlistinfo',pid:id,pn:String(page-1),rn:String(limit),encode:'utf8',keyset:'pl2012',identity:'kuwo',pcmp4:'1',vipver:'MUSIC_9.0.5.0_W1',newver:'1'}),signal)
    if(data.result!=='ok' || data.ispub===false || !Array.isArray(data.musiclist))throw new Error('酷我歌单不可访问或不是公开歌单')
    rows=data.musiclist;total=Number(data.total);name=clean(data.title)
  } else if(source==='tx') {
    const data=await request(source,'https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?'+new URLSearchParams({type:'1',json:'1',utf8:'1',onlysong:'0',new_format:'1',disstid:id,format:'json'}),signal)
    const list=data.cdlist?.[0];if(data.code!==0||!Array.isArray(list?.songlist))throw new Error('QQ 歌单不可访问、已删除或需要登录')
    rows=list.songlist;total=Number(list.total_song_num ?? rows.length);name=clean(list.dissname);sliced=true
    if(total>rows.length)throw new Error('QQ 接口只返回了部分歌曲，暂不导入不完整歌单')
  } else if(source==='wy') {
    const data=await request(source,'https://music.163.com/api/v6/playlist/detail?'+new URLSearchParams({id,n:'100000',s:'0'}),signal)
    const list=data.playlist;if(data.code!==200||!Array.isArray(list?.tracks))throw new Error('网易云歌单不可访问、已删除或需要登录')
    rows=list.tracks;name=clean(list.name);total=Number(list.trackCount??rows.length);sliced=true
    if(Array.isArray(list.trackIds)&&list.trackIds.length>rows.length) {
      const ids=list.trackIds.slice((page-1)*limit,page*limit).map((r:any)=>String(r.id));if(ids.some((s:string)=>!validId(s)))throw new Error('歌单歌曲 ID 无效')
      const detail=await request(source,'https://music.163.com/api/v3/song/detail?'+new URLSearchParams({c:JSON.stringify(ids.map((id:string)=>({id}))),ids:JSON.stringify(ids)}),signal)
      if(detail.code!==200||!Array.isArray(detail.songs)||detail.songs.length!==ids.length)throw new Error('网易云接口未返回完整歌曲，导入已取消')
      const byId=new Map(detail.songs.map((r:any)=>[String(r.id),r]));rows=ids.map((id:string)=>byId.get(id));sliced=false;total=list.trackIds.length
    } else if(total>rows.length)throw new Error('网易云接口只返回了部分歌曲，暂不导入不完整歌单')
  } else if(source==='kg') {
    // Parse JSON only, never execute scripts embedded in the public share page.
    const html=await request(source,'https://www.kugou.com/yy/special/single/'+id+'.html',signal,true)
    rows=publicSongArray(String(html))
    const info=String(html).match(/var\s+specialInfo\s*=\s*(\{[^\r\n]*\})\s*;/)
    name=info?clean(JSON.parse(info[1]).name):clean(String(html).match(/<title>(.*?)_/)?.[1]);total=rows.length;sliced=true
  } else if(source==='mg') {
    const data=await request(source,'https://app.c.nf.migu.cn/MIGUM3.0/resource/playlist/song/v2.0?'+new URLSearchParams({pageNo:String(page),pageSize:String(limit),playlistId:id}),signal)
    if(data.code!=='000000'||!Array.isArray(data.data?.songList))throw new Error('咪咕歌单不可访问、已删除或需要登录')
    rows=data.data.songList;total=Number(data.data.totalCount)
    if(page===1){const info=await request(source,'https://c.musicapp.migu.cn/MIGUM3.0/resource/playlist/v2.0?playlistId='+id,signal);name=clean(info.data?.title||info.data?.name||info.data?.playlistName)}
  } else throw new Error('不支持该平台歌单')
  if(sliced)rows=rows.slice((page-1)*limit,page*limit)
  if(!rows.length && total>(page-1)*limit)throw new Error('歌单分页缺失，导入已取消')
  const items=rows.map(r=>mapLxSong(source,r));if(items.some(r=>!r))throw new Error('歌单包含无法识别的歌曲，导入已取消')
  for(const item of items)if(item.metadata?.artworkUrl)item.metadata.artworkUrl=cover(item.metadata.artworkUrl)
  return {items,playlist:{name:name||LX_SOURCE_NAMES[source]+'歌单 '+id},nextCursor:rows.length&&page*limit<total?String(page+1):undefined}
}
