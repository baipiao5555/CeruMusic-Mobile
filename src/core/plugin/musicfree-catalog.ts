import { reactive } from 'vue'
import { repositoryPath, repositoryUrl, requestRepository, type CatalogLine } from './distribution'
import { distributionState } from './distribution'
import seed from './musicfree-seed.json'
import { musicFreeManifest, musicFreeSnapshots, musicFreeSlug } from './musicfree'
import type { CatalogItem } from './catalog'

const KEY='ceru.musicfree.catalog.v1'
const metadataByFile=new Map(Object.values(musicFreeSnapshots).map(item=>[item.file,item]))
export function parseMusicFreeCatalog(input:any,line:CatalogLine=distributionState.line):CatalogItem[]{
  if(!Array.isArray(input?.plugins)||input.plugins.length>1000)throw new Error('MusicFree 订阅目录格式不正确')
  const seen=new Set<string>()
  return input.plugins.map((item:any)=>{
    if(typeof item?.name!=='string'||!item.name||typeof item.url!=='string'||typeof item.version!=='string')throw new Error('MusicFree 条目缺少名称、版本或链接')
    const path=repositoryPath(item.url)
    if(!path?.startsWith('plugins/')||!/^plugins\/[a-zA-Z0-9_.-]+\.js$/.test(path))throw new Error('MusicFree 链接不属于指定音源仓库')
    const file=path.split('/').pop()!,meta=metadataByFile.get(file),id='musicfree.hebijunge.'+musicFreeSlug(file)
    if(seen.has(id))throw new Error('MusicFree 目录存在重复音源 ID')
    seen.add(id)
    const common=['qq','kuwo','kugou','netease','migu','qishui','bilibili'].includes(meta?.platform||musicFreeSlug(file))
    const category=common?'常用音乐':/dj|mix|dianyinge|edm/.test(file)?'DJ电音':/ting|radio|fm|missevan|xiangsheng|fanqie|lrts|cctv/.test(file)?'听书电台':'其他'
    return {key:id,manifestId:id,name:item.name,version:item.version,author:meta?.author||'',description:meta?.description||'MusicFree 插件，安装后按实际接口提供能力',format:'musicfree',category,url:repositoryUrl(path,line)}
  })
}
export const musicFreeCatalogState=reactive({items:parseMusicFreeCatalog(seed),loading:false,error:'',cachedAt:0})
try{const cached=JSON.parse(localStorage.getItem(KEY)||'null');if(cached?.data){musicFreeCatalogState.items=parseMusicFreeCatalog(cached.data);musicFreeCatalogState.cachedAt=cached.time||0}}catch{}
export async function refreshMusicFreeCatalog(force=false,line:CatalogLine=distributionState.line):Promise<void>{
  if(musicFreeCatalogState.loading||(!force&&Date.now()-musicFreeCatalogState.cachedAt<6*3600000))return
  musicFreeCatalogState.loading=true;musicFreeCatalogState.error=''
  try{
    const result=await requestRepository('plugins.json',{line})
    if(result.status<200||result.status>=300)throw new Error('MusicFree 目录获取失败：HTTP '+result.status)
    const data=typeof result.body==='string'?JSON.parse(result.body):result.body
    const items=parseMusicFreeCatalog(data,line),time=Date.now()
    localStorage.setItem(KEY,JSON.stringify({data,time}))
    musicFreeCatalogState.items=items;musicFreeCatalogState.cachedAt=time
  }catch(e:any){musicFreeCatalogState.error=(e.message||'MusicFree 目录失败')+'；保留上次目录'}
  finally{musicFreeCatalogState.loading=false}
}
export function musicFreeCatalogManifest(item:CatalogItem):any|undefined{
  const file=repositoryPath(item.url)?.split('/').pop(),meta=file?metadataByFile.get(file):undefined
  return meta?musicFreeManifest(meta):undefined
}
