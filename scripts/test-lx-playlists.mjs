import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createServer} from 'vite';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),out=path.resolve(root,'../evidence');const live=process.argv.includes('--live');
const server=await createServer({root,server:{middlewareMode:true},appType:'custom'});let originalFetch=globalThis.fetch;const checks=[],requests=[];
const pass=(s)=>{checks.push(s);console.log('PASS',s)};
try {
 const api=await server.ssrLoadModule('/src/core/plugin/lx-playlists.ts');
 const links={kw:'https://m.kuwo.cn/h5app/playlist/2736267853?t=qqfriend',kg:'https://www.kugou.com/yy/special/single/1067062.html',tx:'https://i.y.qq.com/n2/m/share/details/taoge.html?id=7217720898',wy:'https://music.163.com/#/playlist?id=3778678',mg:'https://music.migu.cn/v5/#/playlist?playlistId=221573417'};
 for(const [s,url] of Object.entries(links))assert.match(api.parseLxPlaylistInput(s,'分享歌单 '+url),/^\d+$/);
 assert.equal(api.parseLxPlaylistInput('mg','https://h5.nf.migu.cn/app/v4/p/share/playlist/index.html?id=221573417'),'221573417');
 for(const url of ['https://music.163.com/song?id=123','https://music.163.com.evil.test/#/playlist?id=123','https://127.0.0.1/playlist?id=123','https://u:p@music.163.com/#/playlist?id=123','https://y.qq.com/n/yqq/playlist/7217720898.html'])assert.throws(()=>api.parseLxPlaylistInput('wy',url));
 pass('5 platforms parse canonical share links; foreign/song/private-network/credential URLs are rejected');
 if(!live) globalThis.fetch=async (url,opts)=>{
   requests.push(String(url));const u=new URL(url);let name;
   if(u.hostname.includes('kuwo'))name=u.pathname.includes('getTagList')?'kw-tags':u.pathname.includes('pl.svc')?'kw-detail':'kw-recommend';
   if(u.hostname.includes('kugou'))name=u.pathname.includes('single')?'kg-html':u.searchParams.has('is_smarty')?'kg-tags':'kg-lists';
   if(u.hostname.includes('qq.com'))name=u.pathname.includes('getcdinfo')?'tx-detail':u.search.includes('get_all_categories')?'tx-tags':'tx-recommend';
   if(u.hostname.includes('163.com'))name=u.pathname.includes('catalogue')?'wy-tags':u.pathname.includes('detail')?'wy-detail':'wy-recommend';
   if(u.hostname.includes('migu'))name=u.pathname.includes('taglist')?'mg-tags':u.pathname.includes('/song/')?'mg-detail':u.pathname.includes('playlist-square')?'mg-recommend':'mg-info';
   if(name==='mg-info')return new Response(JSON.stringify({code:'000000',data:{title:'咪咕公开歌单'}}),{status:200});
   let body=fs.readFileSync(out+'/'+name+'.raw.txt','utf8');
   if(name==='kw-detail'||name==='mg-detail'){const d=JSON.parse(body),page=Number(u.searchParams.get(name==='kw-detail'?'pn':'pageNo'))+(name==='kw-detail'?1:0),size=Number(u.searchParams.get(name==='kw-detail'?'rn':'pageSize'));const list=name==='kw-detail'?d.musiclist:d.data.songList;const subset=list.slice((page-1)*size,page*size);if(name==='kw-detail'){d.musiclist=subset;d.total=list.length}else{d.data.songList=subset;d.data.totalCount=list.length}body=JSON.stringify(d)}
   return new Response(body,{status:200,headers:{'Content-Type':name==='kg-html'?'text/html;charset=utf-8':'application/json;charset=utf-8'}})
 };
 const results=[];
 for(const s of api.LX_PLAYLIST_SOURCES){
   const cats=await api.listLxPlaylistCategories(s);assert(cats.items.length>1,s+' categories');
   const lists=await api.listLxPlaylists(s,cats.items[0].ref);assert(lists.items.length>0,s+' recommendations');
   let categoryCount, recommendedTracks;
   if(live){const tagged=await api.listLxPlaylists(s,cats.items[1].ref);assert(tagged.items.length>0,s+' tagged playlists');categoryCount=tagged.items.length;const recommended=await api.getLxPlaylist(s,lists.items[0].ref,undefined,10);assert(recommended.items.length>0,s+' recommended playlist detail');recommendedTracks=recommended.items.length;}
   const id=api.parseLxPlaylistInput(s,links[s]),detail=await api.getLxPlaylist(s,{id},undefined,30);assert(detail.items.length>0,s+' detail');
   for(const item of detail.items){assert.equal(item.ref.providerId,s);assert(item.ref.id&&item.title);assert(item.ref.data.lxMusicInfo);assert(item.metadata.durationMs>0)}
   results.push({platform:s,categories:cats.items.length,playlists:lists.items.length,categoryPlaylistCount:categoryCount,recommendedPlaylistTracks:recommendedTracks,tracks:detail.items.length,name:detail.playlist.name,firstTrack:{id:detail.items[0].ref.id,title:detail.items[0].title,qualities:detail.items[0].metadata.qualities,cover:detail.items[0].metadata.artworkUrl},nextCursor:detail.nextCursor});
   pass(`${s}: real adapter loads categories, recommendation playlists, and song metadata`);
 }
 if(!live){
   globalThis.fetch=async()=>new Response(JSON.stringify({code:200,result:'error'}),{status:200});await assert.rejects(()=>api.getLxPlaylist('kw',{id:'2736267853'}),/不可访问/);
   globalThis.fetch=async()=>new Response('Access Deny !',{status:200});await assert.rejects(()=>api.listLxPlaylists('kw',{id:'recommend'}),/无效数据/);
   const cats=await api.listLxPlaylistCategories('kw');assert.equal(cats.items.length,1);assert(cats.warning);
   pass('Business errors and HTML denial fail explicitly; taxonomy failure preserves only the recommendation entry');
 }
 fs.writeFileSync(out+'/'+(live?'live-lx-playlists':'lx-playlists-unit')+'.json',JSON.stringify({mode:live?'live public endpoints from current host':'replay captured public service payloads; no service availability claim',checks,results,requests},null,2));
} catch(e){console.error(e);process.exitCode=1}finally{globalThis.fetch=originalFetch;await server.close()}
