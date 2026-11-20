import { requestRemote, validateRemoteUrl } from './network'
import { mapLxSong } from './lx-catalog'

export const LX_HOME_SOURCES = ['kg','tx','wy']
async function request(url:string, options:any={}):Promise<any> {
  const response=await requestRemote({url,timeoutMs:12_000,...options})
  if(response.status<200||response.status>=300||!response.body||typeof response.body!=='object')throw new Error('榜单接口返回无效数据：HTTP '+response.status)
  return response.body
}
function image(value:any):string|undefined {
  if(typeof value!=='string'||!value)return undefined
  try{return validateRemoteUrl(value.trim().replace(/^http:/i,'https:').replace(/\{size\}/g,'480')).href}catch{return undefined}
}
function chart(source:string,id:any,title:any,cover:any):any {
  return {ref:{providerId:source,kind:'chart',id:String(id),scope:'provider'},title:String(title||'榜单'),metadata:{artworkUrl:image(cover)},chart:{artworkUrl:image(cover)}}
}
export async function listLxCharts(source:string):Promise<any> {
  let items:any[]=[]
  if(source==='kg') {
    const data=await request('http://mobilecdn.kugou.com/api/v3/rank/list?format=json')
    if(!Array.isArray(data.data?.info))throw new Error('酷狗榜单数据格式变化')
    items=data.data.info.map((r:any)=>chart(source,r.rankid,r.rankname,r.imgurl)).filter((r:any)=>/^\d+$/.test(r.ref.id))
  } else if(source==='wy') {
    const data=await request('https://music.163.com/api/toplist',{headers:{Referer:'https://music.163.com/'}})
    if(!Array.isArray(data.list))throw new Error('网易云榜单数据格式变化')
    items=data.list.map((r:any)=>chart(source,r.id,r.name,r.coverImgUrl))
  } else if(source==='tx') {
    const data=await request('https://u.y.qq.com/cgi-bin/musicu.fcg',{method:'POST',headers:{'Content-Type':'application/json',Referer:'https://y.qq.com/'},body:JSON.stringify({comm:{ct:24},req_0:{module:'musicToplist.ToplistInfoServer',method:'GetAll',param:{}}})})
    const groups=data.req_0?.data?.group
    if(!Array.isArray(groups))throw new Error('QQ 榜单数据格式变化')
    items=groups.flatMap((g:any)=>g.toplist||[]).map((r:any)=>chart(source,r.topId,r.title,r.frontPicUrl||r.headPicUrl))
  } else throw new Error('该 LX 平台尚未提供榜单目录')
  return {items:items.slice(0,100)}
}
export async function getLxChartTracks(source:string,ref:any,cursor?:string):Promise<any> {
  const id=String(ref?.id||'');if(!/^\d{1,20}$/.test(id))throw new Error('无效榜单 ID')
  const page=Math.max(1,Number(cursor)||1),limit=30;let rows:any[]=[],total:number|undefined
  if(source==='kg') {
    const url='http://mobilecdn.kugou.com/api/v3/rank/song?'+new URLSearchParams({version:'9108',ranktype:'1',plat:'0',pagesize:String(limit),area_code:'1',page:String(page),rankid:id,with_res_tag:'0',show_portrait_mv:'1'})
    const data=await request(url);rows=data.data?.info;total=Number(data.data?.total)
    if(!Array.isArray(rows))throw new Error('酷狗榜单歌曲格式变化')
    rows=rows.map((r:any)=>({ ...r,FileHash:r.hash,HQFileHash:r['320hash'],SQFileHash:r.sqhash,Audioid:r.album_audio_id,SongName:r.songname||r.filename?.split(' - ').slice(1).join(' - '),SingerName:r.singername||r.filename?.split(' - ')[0],Duration:r.duration,AlbumID:r.album_id }))
  } else if(source==='wy') {
    const data=await request('https://music.163.com/api/playlist/detail?'+new URLSearchParams({id}),{headers:{Referer:'https://music.163.com/'}})
    const tracks=data.result?.tracks||data.playlist?.tracks;if(!Array.isArray(tracks))throw new Error('网易云榜单歌曲格式变化')
    total=tracks.length;rows=tracks.slice((page-1)*limit,page*limit)
  } else if(source==='tx') {
    const data=await request('https://u.y.qq.com/cgi-bin/musicu.fcg',{method:'POST',headers:{'Content-Type':'application/json',Referer:'https://y.qq.com/'},body:JSON.stringify({comm:{ct:24},req_0:{module:'musicToplist.ToplistInfoServer',method:'GetDetail',param:{topid:Number(id),num:limit,offset:(page-1)*limit}}})})
    rows=data.req_0?.data?.songInfoList;total=Number(data.req_0?.data?.data?.totalNum);if(!Array.isArray(rows))throw new Error('QQ 榜单歌曲格式变化')
  }
  const items=rows.map(r=>mapLxSong(source,r)).filter(Boolean)
  return {items,nextCursor:rows.length && (Number.isFinite(total)?page*limit<total!:rows.length>=limit)?String(page+1):undefined}
}
