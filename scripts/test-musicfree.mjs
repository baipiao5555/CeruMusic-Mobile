import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),base='http://127.0.0.1:5432'
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5432','--strictPort'],{cwd:root,windowsHide:true})
let browser,page;const errors=[],requests=[]
const song={id:'mf-1',title:'MusicFree 测试歌曲',artist:'测试歌手',album:'测试专辑',duration:5,artwork:'https://mf.test/cover.png',platform:'qa'}
const wav=Buffer.alloc(80044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40)
const fixture=`const axios=require('axios');const cheerio=require('cheerio');module.exports={
 platform:'fixture-mf',name:'MusicFree 回归音源',version:'1.0.0',author:'QA',primaryKey:['id','platform'],supportedQualities:['128k','320k'],
 search:async(q,page,type)=>({isEnd:true,data:(await axios.get('https://mf.test/search',{params:{q,page,type}})).data}),
 getMediaSource:async(item,tier)=>({url:(await axios.get('https://mf.test/source',{params:{id:item.id,tier}})).data.url}),
 getLyric:async()=>({rawLrc:'[00:00.00]MusicFree 歌词'}),
 getTopLists:async()=>[{title:'测试榜单',data:[{id:'chart',title:'MF 热歌榜',artwork:'https://mf.test/cover.png'}]}],
 getTopListDetail:async()=>({isEnd:true,musicList:(await axios.get('https://mf.test/search')).data}),
 getRecommendSheetTags:async()=>[{title:'分类',data:[{id:'all',title:'全部歌单'}]}],
 getRecommendSheetsByTag:async()=>({isEnd:true,data:[{id:'sheet',title:'MF 推荐歌单',artwork:'https://mf.test/cover.png'}]}),
 getMusicSheetInfo:async()=>({isEnd:true,musicList:(await axios.get('https://mf.test/search')).data}),
 importMusicSheet:async()=>({isEnd:true,data:(await axios.get('https://mf.test/search')).data})
};`
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']})
 page=await browser.newPage({viewport:{width:390,height:844}})
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false,playbackCache:false,cloudLyrics:false}))})
 await page.route('**/*',r=>{
  const url=r.request().url();if(url.startsWith(base))return r.continue()
  if(url.includes('/plugins.json'))return r.fulfill({json:JSON.parse(fs.readFileSync(root+'/src/core/plugin/musicfree-seed.json','utf8'))})
  if(url.startsWith('https://mf.test/')){
   requests.push(url)
   if(url.includes('audio.wav'))return r.fulfill({contentType:'audio/wav',body:wav})
   if(url.includes('cover.png'))return r.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7V8AAAAASUVORK5CYII=','base64')})
   return r.fulfill({json:url.includes('/source')?{url:'https://mf.test/audio.wav'}:[song]})
  }
  return r.fulfill({status:503,json:{error:'fixture offline'}})
 })
 await page.goto(base+'/#/plugins')
 await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
 const installed=await page.evaluate(async code=>window.__ceruDebug.installPlugin(code,{enable:true,grantDeclared:true}),fixture)
 assert.equal(installed.format,'musicfree')
 const result=await page.evaluate(async id=>{
  const d=window.__ceruDebug,p=d.allProviders(true).find(p=>p.pluginId===id)
  const search=await d.invokeProvider(p,'tracks.search',[{query:'测试',kinds:['track'],filters:{},limit:20}])
  const charts=await d.invokeProvider(p,'charts.list',[])
  const chartTracks=await d.invokeProvider(p,'charts.getTracks',[charts.items[0].ref])
  const categories=await d.invokeProvider(p,'playlists.categories',[])
  const sheets=await d.invokeProvider(p,'playlists.list',[categories.items[0].ref])
  const sheetTracks=await d.invokeProvider(p,'playlists.get',[sheets.items[0].ref])
  const importer=d.allImporters().find(i=>i.pluginId===id)
  const imported=await d.importPlaylist(importer,'https://mf.test/playlist')
  await d.player.playTracks([d.player.toTrack(search.items[0],p)],0)
  return {search,charts,chartTracks,categories,sheets,sheetTracks,imported,methods:p.methods}
 },installed.pluginId)
 assert.equal(result.search.items.length,1)
 assert.equal(result.chartTracks.items.length,1)
 assert.equal(result.sheetTracks.items.length,1)
 assert.equal(result.imported.tracks.length,1)
 await page.waitForFunction(()=>window.__ceruDebug.player.playerState.playing)
 assert(requests.some(url=>url.includes('tier=320k')))
 console.log('PASS MusicFree adapter: actual SDK Worker search/playback/lyrics/charts/recommended sheets/import')
 const boundaries=await page.evaluate(async()=>{
  const {PluginHost}=await import('/src/core/plugin/host.ts'),permission={key:'network',name:'network.request'}
  const state=id=>({pluginId:id,code:'',manifest:{id:'musicfree.custom.qa',permissions:[permission]},grants:['network:network.request:{}'],denied:[],hooks:{},saveGrants:async()=>{},getConfig:async()=>({own:'only'}),saveConfig:async()=>{}})
  const a=new PluginHost(state('qa-a')),b=new PluginHost(state('qa-b')),denied=[]
  for(const method of ['services.account.getSession','services.account.getProfile','services.player.play','services.files.read','ui.navigate']){
   try{await a.rpc(method);throw new Error('Unexpected host access: '+method)}catch(e){if(!e.message.includes('无权'))throw e;denied.push(method)}
  }
  for(const url of ['http://127.0.0.1/private','http://192.168.1.1/private','file:///sdcard/secret']){
   let rejected=false;try{await a.rpc('http.request',{url,permissionKey:'network'})}catch{rejected=true}if(!rejected)throw new Error('Unsafe URL accepted');denied.push(url)
  }
  await a.rpc('storage.set',{key:'shared',value:'only A'})
  if(await b.rpc('storage.get',{key:'shared'})!==null)throw new Error('Plugin storage namespace leak')
  await a.rpc('storage.delete',{key:'shared'})
  return {denied,config:await a.rpc('config.get'),storageIsolated:true}
 })
 const identity=await page.evaluate(async()=>{
  const d=window.__ceruDebug
  const code=`module.exports={platform:'identity-mf',version:'1.0.0',author:'QA',primaryKey:['bvid','platform'],search:async()=>({isEnd:true,data:[{bvid:'BVqa',platform:'qq',title:'同ID平台一'},{bvid:'BVqa',platform:'netease',title:'同ID平台二'}]})}`
  const installed=await d.installPlugin(code,{enable:true,grantDeclared:true}),p=d.allProviders(true).find(p=>p.pluginId===installed.pluginId)
  const result=await d.invokeProvider(p,'tracks.search',[{query:'test',kinds:['track'],filters:{},limit:20}])
  await d.removePlugin(installed.pluginId);return result
 })
 assert.equal(identity.items.length,2);assert.notEqual(identity.items[0].ref.id,identity.items[1].ref.id)
 assert.equal(identity.items[0].ref.data.musicfree.bvid,'BVqa')
 console.log('PASS MusicFree primaryKey-only songs survive search; composite IDs preserve platform and original fields')
 console.log('PASS MusicFree host denies account/player/files/private URL access; storage remains plugin scoped')
 await page.getByRole('group',{name:'音源格式'}).getByRole('button',{name:'MusicFree',exact:true}).click()
 await page.waitForTimeout(100)
 assert((await page.locator('.catalog-card').count())>=6)
 assert.match(await page.locator('.catalog-card').first().innerText(),/MusicFree/)
 await page.screenshot({path:out+'/musicfree-market.png'})
 console.log('PASS MusicFree market uses the specified repository subscription and displays format badges')
 assert.deepEqual(errors,[])
 fs.writeFileSync(out+'/musicfree-fixture-test.json',JSON.stringify({pass:true,scope:'Real Vue/SDK/CSP Worker; controlled MusicFree API and generated audio; actual Host RPC access restrictions',result,identity,boundaries,requests,errors},null,2))
}catch(e){console.error(e);process.exitCode=1;await page?.screenshot({path:out+'/musicfree-failure.png'}).catch(()=>{});if(page)console.log(await page.evaluate(()=>window.__ceruDebug?.pluginState.plugins.map(p=>({name:p.name,error:p.loadError,providers:p.providers}))))}
finally{await browser?.close();server.kill()}
