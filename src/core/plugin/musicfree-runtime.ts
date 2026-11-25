/** Serialized only into the CSP-restricted plugin Worker, not the app window. */
export async function installMusicFreeAdapter(core: any, source: string, manifest: any, metadata: any, parseLyrics: any): Promise<void> {
  const modules=(globalThis as any).__musicFreeModules
  if(!modules?.axios)throw new Error('MusicFree 兼容运行时未加载')
  let variables=await core.config.get()
  let axios: any
  axios=modules.axios.create({adapter:async (input:any)=>{
    const url=axios.getUri(input)
    // The SDK convenience HTTP client drops binary/text options. Use its same
    // permission-checked Host broker so audio probes are not decoded as JSON/text.
    const response=await core.http.request({url,permissionKey:'network',method:input.method,headers:input.headers?.toJSON?input.headers.toJSON():input.headers,
      body:input.data==null?undefined:String(input.data),timeoutMs:Math.min(20_000,Number(input.timeout)||12_000),
      responseType:input.responseType==='arraybuffer'?'arraybuffer':undefined,raw:input.responseType==='text'})
    const data=input.responseType==='arraybuffer'&&ArrayBuffer.isView(response.body)?new Uint8Array(response.body.buffer,response.body.byteOffset,response.body.byteLength).slice().buffer:response.body
    const result={data,status:response.status,statusText:String(response.status),headers:response.headers,config:input}
    if(input.validateStatus&&!input.validateStatus(response.status))throw Object.assign(new Error('MusicFree 请求失败：HTTP '+response.status),{response:result})
    return result
  }})
  for(const name of ['Axios','AxiosError','AxiosHeaders','CancelToken','isCancel','isAxiosError','all','spread','HttpStatusCode','VERSION','toFormData','formToJSON'])if(modules.axios[name])axios[name]=modules.axios[name]
  axios.default=axios
  const env={getUserVariables:()=>({...variables}),getMusicFreeVersion:()=> '0.6.0',getCache:async()=>null,setCache:async()=>{},removeCache:async()=>{}}
  const require=(name:string)=>{
    if(name==='axios')return axios
    if(name==='@musicfree/plugin-env')return env
    if(name==='buffer')return {Buffer:(globalThis as any).Buffer}
    if(modules[name])return modules[name]
    throw new Error('MusicFree 兼容暂不支持模块：'+name)
  }
  const module={exports:{} as any}
  new Function('module','exports','require','env','getUserVariables',source)(module,module.exports,require,env,env.getUserVariables)
  const plugin=module.exports?.default?.platform?module.exports.default:module.exports
  if(!plugin||typeof plugin.platform!=='string')throw new Error('文件没有有效 MusicFree 导出')
  if(String(plugin.version||'')!==manifest.version)throw new Error('MusicFree 文件版本与目录不一致')
  variables={...Object.fromEntries((plugin.userVariables||[]).map((v:any)=>[v.key,v.defaultValue??''])),...variables}
  const providerId=manifest.contributes.providers[0].id
  const title=(v:any)=>String(v?.title||v?.name||v?.songname||'未命名')
  const identity=(kind:string,v:any)=>{
    const keys=kind==='track'&&Array.isArray(metadata.primaryKey)?metadata.primaryKey:[]
    if(keys.length&&keys.every((key:string)=>v[key]!=null))return keys.length===1?String(v[keys[0]]):JSON.stringify(keys.map((key:string)=>v[key]))
    return String(v?.id??v?.hash??v?.songmid??v?.topId??'')
  }
  const ref=(kind:string,v:any)=>({providerId,kind,id:identity(kind,v),pluginId:core.plugin.id,...(kind==='track'?{scope:'provider'}:{}),data:{musicfree:v}})
  const track=(v:any)=>({
    ref:ref('track',v), title:title(v),capabilities:typeof plugin.getMediaSource==='function'?['play']:[],
    metadata:{artists:Array.isArray(v.artist)?v.artist:[String(v.artist||v.singer||'未知歌手')],album:{title:String(v.album?.title||v.album||'')},
      durationMs:Number(v.durationMs)||Math.round((Number(v.duration)||0)*1000),artworkUrl:String(v.artwork||v.cover||v.pic||''),
      qualities:manifest.contributes.providers[0].qualities}
  })
  const list=(result:any,page=1)=>{
    const data=Array.isArray(result)?result:result?.data??result?.musicList??[]
    if(!Array.isArray(data))throw new Error('MusicFree 接口返回了非列表结果')
    return {items:data.filter(v=>v && identity('track',v)).map(track),nextCursor:result?.isEnd===false?String(page+1):undefined}
  }
  const method=(fn:any)=>async(...args:any[])=>{variables={...variables,...await core.config.get()};return fn(...args)}
  const implementations:any={tracks:{}}
  if(typeof plugin.search==='function')implementations.tracks.search=method(async(request:any)=>list(await plugin.search(String(request.query||''),Number(request.cursor)||1,'music')))
  if(typeof plugin.getMediaSource==='function')implementations.tracks.resolve=method(async(resource:any,quality:string)=>{
    const map:any={'128k':'low','192k':'standard','320k':'standard','flac':'high','flac24bit':'super'}
    const tier=metadata.supportedQualities?.length?quality:map[quality]||quality
    const value=await plugin.getMediaSource(resource.data?.musicfree,tier)
    const url=typeof value==='string'?value:value?.url
    return url?{ok:true,url,requestHeaders:value?.headers||value?.requestHeaders||{}}:{ok:false,error:{message:'该音质没有返回可播放地址'}}
  })
  implementations.tracks.artwork=method(async(resource:any)=>{
    const original=resource.data?.musicfree||{}
    if(original.artwork)return original.artwork
    if(typeof plugin.getMusicInfo==='function')return (await plugin.getMusicInfo(original))?.artwork||''
    return ''
  })
  if(typeof plugin.getLyric==='function')implementations.tracks.lyrics=method(async(resource:any)=>{
    const value=await plugin.getLyric(resource.data?.musicfree)
    const parsed=parseLyrics({lyric:typeof value==='string'?value:value?.rawLrc||value?.lyric||'',tlyric:value?.translation||value?.tlyric||''})
    return {format:'crlyric',version:1,track:resource,offsetMs:0,...parsed}
  })
  if(typeof plugin.getTopLists==='function'){
    implementations.charts={list:method(async()=>{
      const groups=await plugin.getTopLists()
      if(!Array.isArray(groups))throw new Error('MusicFree 榜单返回格式不正确')
      const items=groups.flatMap(v=>Array.isArray(v.data)?v.data:[v])
      return {items:items.filter(v=>v?.id!=null).map(v=>({ref:ref('chart',v),title:title(v),capabilities:[],chart:{artworkUrl:String(v.artwork||''),updateFrequency:''}}))}
    })}
    if(typeof plugin.getTopListDetail==='function')implementations.charts.getTracks=method(async(resource:any,cursor:any)=>list(await plugin.getTopListDetail(resource.data?.musicfree,Number(cursor)||1),Number(cursor)||1))
  }
  const getSheet=plugin.getMusicSheetInfo
  const flattenTags=(value:any):any[]=>{const out:any[]=[];const seen=new Set<string>();const visit=(node:any,depth:number)=>{if(depth>5||!node)return;if(Array.isArray(node)){node.forEach(v=>visit(v,depth+1));return}if(typeof node!=='object')return;const id=node.id??node.tagId??node.key;if(id!=null&&!seen.has(String(id))){seen.add(String(id));out.push(node)};['data','list','tags','categories','groups'].forEach(key=>{if(node[key])visit(node[key],depth+1)})};visit(value,0);return out}
  const unwrapList=(value:any):any[]=>{let current=value;for(let i=0;i<5;i++){if(Array.isArray(current))return current;if(!current||typeof current!=='object')return[];current=current.data??current.list??current.playlists??current.items}return[]}
  if(typeof plugin.getRecommendSheetTags==='function'&&typeof plugin.getRecommendSheetsByTag==='function'){
    implementations.playlists={
      categories:method(async()=>{
        const data=await plugin.getRecommendSheetTags()
        const tags=flattenTags(data)
        return {items:tags.map((v:any)=>({ref:ref('playlist-category',v),title:title(v),capabilities:[]}))}
      }),
      list:method(async(resource:any,cursor:any)=>{
        const value=await plugin.getRecommendSheetsByTag(resource.data?.musicfree,Number(cursor)||1)
        const data=unwrapList(value)
        if(!Array.isArray(data))throw new Error('MusicFree 推荐歌单返回格式不正确')
        return {items:data.filter(v=>v?.id!=null).map(v=>({ref:ref('playlist',v),title:title(v),capabilities:[],playlist:{artworkUrl:String(v.artwork||v.cover||v.pic||''),trackCount:Number(v.worksNum||v.musicList?.length)||0,author:String(v.artist||v.author||'')}})),nextCursor:value?.isEnd===false?String((Number(cursor)||1)+1):undefined}
      })
    }
  }
  if(typeof getSheet==='function'){
    implementations.playlists??={}
    implementations.playlists.get=method(async(resource:any,cursor:any)=>list(await getSheet(resource.data?.musicfree,Number(cursor)||1),Number(cursor)||1))
  }
  if(typeof plugin.importMusicSheet==='function'){
    core.playlistImporters.register('mf-import',{getTracks:method(async(input:any)=>{
      const value=await plugin.importMusicSheet(typeof input==='string'?input:input?.value||input?.url||'')
      return list(value)
    })})
  }
  core.providers.register(providerId,implementations)
}
