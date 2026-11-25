import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),base='http://127.0.0.1:5451',observe=process.argv.includes('--observe')
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5451','--strictPort'],{cwd:root,windowsHide:true})
let browser,page;const requests=[],report={observe,checks:{},requests}
const wav=Buffer.alloc(80044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40)
const source=String.raw`module.exports={platform:'headerqa',name:'MusicFree 请求头验证',author:'QA',version:'1.0.0',primaryKey:['id'],supportedQualities:['128k'],search:async()=>({isEnd:true,data:[{id:'qa',title:'请求头测试歌曲',artist:'QA',duration:5}]}),getMediaSource:async()=>({url:'https://mf.audio.test/audio.wav',headers:{'X-QA-Audio':'required','Referer':'https://mf.audio.test/'}}),getLyric:async()=>({rawLrc:'[00:00.00]原始歌词\n[00:01.00]第二行',translation:'[00:00.00]翻译歌词'})}`
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']})
 page=await browser.newPage({viewport:{width:412,height:906}})
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false,playbackCache:false,cloudLyrics:false}))})
 await page.route('**/*',r=>{
  const url=r.request().url();if(url.startsWith(base))return r.continue()
  if(url.includes('mf.audio.test/audio.wav')){
   const headers=r.request().headers(),allowed=headers['x-qa-audio']==='required';requests.push({url,headers,status:allowed?200:403})
   return r.fulfill(allowed?{contentType:'audio/wav',body:wav}:{status:403,contentType:'text/html',body:'missing required source headers'})
  }
  if(url.includes('mf.audio.test/probe'))return r.fulfill({contentType:'application/octet-stream',body:Buffer.from([255,251,144,100,0,128])})
  return r.fulfill({status:503,json:{error:'controlled offline'}})
 })
 await page.goto(base+'/#/plugins');await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
 const oldCode=observe?undefined:fs.readFileSync(out+'/musicfree-headerqa-old-code.js','utf8')
 report.checks=await page.evaluate(async({source,oldCode})=>{
  const d=window.__ceruDebug,prepared=oldCode||await d.preparePluginCode(source),installed=await d.installPlugin(prepared,{enable:true,grantDeclared:true,installOrigin:'file'}),p=d.allProviders(true).find(p=>p.pluginId===installed.pluginId)
  await d.savePluginConfig(installed.pluginId,{qaMarker:'keep'})
  const search=await d.invokeProvider(p,'tracks.search',[{query:'测试',kinds:['track'],filters:{},limit:20}]),ref=search.items[0].ref
  const resolved=await d.invokeProvider(p,'tracks.resolve',[ref,'128k'])
  let lyrics,lyricError;try{lyrics=await d.invokeProvider(p,'tracks.lyrics',[ref])}catch(e){lyricError=e.message}
  let playbackError;try{await d.player.playTracks([d.player.toTrack(search.items[0],p)],0)}catch(e){playbackError=e.message}
  window.__qaMusicFreeTrack=d.player.toTrack(search.items[0],p)
  return {prepared,pluginId:installed.pluginId,resolved,lyrics,lyricError,playbackError,playing:d.player.playerState.playing,currentTime:d.player.playerState.currentTime}
 },{source,oldCode})
 if(observe){fs.writeFileSync(out+'/musicfree-headerqa-old-code.js',report.checks.prepared);delete report.checks.prepared}
 if(!observe){
  assert.equal(report.checks.resolved.requestHeaders?.['X-QA-Audio'],'required','MusicFree headers must use SDK requestHeaders')
  assert.equal(report.checks.lyricError,undefined)
  assert.equal(report.checks.lyrics.lines.length,2);assert.equal(report.checks.lyrics.lines[0].translation,'翻译歌词')
  assert.equal(report.checks.lyrics.track.kind,'track');assert.equal(report.checks.lyrics.offsetMs,0)
  assert.equal(report.checks.playbackError,undefined)
  await page.waitForFunction(()=>window.__ceruDebug.player.playerState.playing&&window.__ceruDebug.player.playerState.currentTime>0.2)
  assert(requests.some(r=>r.status===200));assert(!requests.some(r=>r.status===403))
  report.binary=await page.evaluate(async()=>{
   const d=window.__ceruDebug,code=`const axios=require('axios');module.exports={platform:'binaryqa',version:'1.0.0',author:'QA',supportedQualities:['128k'],search:async()=>({isEnd:true,data:[{id:'probe',title:'二进制探测',artist:'QA'}]}),getMediaSource:async()=>{const response=await axios.get('https://mf.audio.test/probe',{responseType:'arraybuffer',headers:{Range:'bytes=0-5'}});const bytes=new Uint8Array(response.data);if(!(response.data instanceof ArrayBuffer)||bytes[0]!==255||bytes[1]!==251)throw new Error('Binary probe corrupted');return {url:'https://mf.audio.test/audio.wav',headers:{'X-QA-Audio':'required'}}}}`
   const installed=await d.installPlugin(code,{enable:true,grantDeclared:true}),p=d.allProviders(true).find(p=>p.pluginId===installed.pluginId)
   const tracks=await d.invokeProvider(p,'tracks.search',[{query:'probe',kinds:['track'],filters:{},limit:20}])
   const result=await d.invokeProvider(p,'tracks.resolve',[tracks.items[0].ref,'128k']);await d.removePlugin(installed.pluginId);return result
  })
  assert.equal(report.binary.ok,true)
  await page.reload();await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
  report.restored=await page.evaluate(async id=>{
   const d=window.__ceruDebug,{idb}=await import('/src/core/storage/idb.ts'),stored=await idb.get('plugins',id)
   const descriptor=d.pluginState.plugins.find(p=>p.pluginId===id)
   return {running:descriptor?.running,pluginId:descriptor?.pluginId,origin:descriptor?.installOrigin,config:await d.getPluginConfig(id),code:stored.code}
  },report.checks.pluginId)
  assert.equal(report.restored.running,true);assert.equal(report.restored.pluginId,report.checks.pluginId)
  assert.equal(report.restored.origin,'file');assert.equal(report.restored.config.qaMarker,'keep');assert.equal(report.restored.code,oldCode)
  delete report.restored.code;delete report.checks.prepared
  console.log('PASS actual SDK Worker -> MusicFree requestHeaders -> protected audio fetch -> real WAV playback; SDK lyrics validation and translation')
  console.log('PASS old installed adapter repaired on activation/restart without replacing stored file, ID, origin or config')
  console.log('PASS MusicFree axios arraybuffer probe preserves actual MP3 header bytes through the Host RPC')
 }else console.log(JSON.stringify(report,null,2))
}catch(e){console.error(e);report.failure=String(e);process.exitCode=1;await page?.screenshot({path:out+'/musicfree-playback-failure.png'}).catch(()=>{})}
finally{fs.writeFileSync(out+'/musicfree-playback-'+(observe?'before':'after')+'.json',JSON.stringify(report,null,2));await browser?.close();server.kill()}
