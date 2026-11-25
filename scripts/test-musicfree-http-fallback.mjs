import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),base='http://127.0.0.1:5453'
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5453','--strictPort'],{cwd:root,windowsHide:true})
const wav=Buffer.alloc(80044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40)
const source=String.raw`const axios=require('axios');module.exports={platform:'fallbackqa',name:'失败探测兼容验证',author:'QA',version:'1.0.0',primaryKey:['id'],supportedQualities:['128k'],search:async()=>({isEnd:true,data:[{id:'fallback-1',title:'探测失败仍可播放',artist:'QA',duration:5}]}),getMediaSource:async()=>{try{await axios.get('https://mf.test/missing-probe',{validateStatus:()=>true})}catch{}return {url:'https://mf.test/audio.wav'}},getLyric:async()=>({rawLrc:'[00:00.00]测试歌词'})}`
let browser,requests=[]
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']})
 const page=await browser.newPage({viewport:{width:412,height:906}})
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false,playbackCache:false,cloudLyrics:false,quality:''}))})
 await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith(base))return r.continue();requests.push(u);if(u.includes('missing-probe'))return r.fulfill({status:404,json:{error:'expected probe miss'}});if(u.includes('audio.wav'))return r.fulfill({contentType:'audio/wav',body:wav});return r.fulfill({status:503,json:{error:'offline'}})})
 await page.goto(base+'/#/plugins');await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
 const initial=await page.evaluate(async code=>{const d=window.__ceruDebug;const plugin=await d.installPlugin(code,{enable:true,grantDeclared:true});const p=d.allProviders(true).find(x=>x.pluginId===plugin.pluginId);const page=await d.invokeProvider(p,'tracks.search',[{query:'test',kinds:['track'],filters:{},limit:10}]);const resolved=await d.invokeProvider(p,'tracks.resolve',[page.items[0].ref,'128k']);await d.player.playTracks([d.player.toTrack(page.items[0],p)],0);return {resolved,pluginId:plugin.pluginId}},source)
 await page.waitForFunction(()=>window.__ceruDebug.player.playerState.playing,{timeout:5000})
 await page.waitForTimeout(1200)
 const result=await page.evaluate(async initial=>{const d=window.__ceruDebug;const out={resolved:initial.resolved,playing:d.player.playerState.playing,currentTime:d.player.playerState.currentTime,error:d.player.playerState.error};await d.removePlugin(initial.pluginId);return out},initial)
 assert.equal(result.error||'', '')
 assert.equal(result.resolved.url,'https://mf.test/audio.wav')
 assert.equal(result.resolved.ok,true)
 assert(result.playing&&result.currentTime>0,JSON.stringify(result))
 assert(requests.some(u=>u.includes('missing-probe')),'404 probe must actually run')
 fs.writeFileSync(out+'/musicfree-http-fallback.json',JSON.stringify({passed:true,result,requests},null,2))
 console.log('PASS valid URL survives an internal 404 probe and real WAV playback starts')
}catch(e){console.error(e);process.exitCode=1}finally{await browser?.close();server.kill()}
