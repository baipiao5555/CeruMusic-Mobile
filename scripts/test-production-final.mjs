import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),base='http://127.0.0.1:5440',errors=[]
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5440','--strictPort'],{cwd:root,windowsHide:true})
let browser,page;const audioRequests=[]
const wav=Buffer.alloc(320044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40)
const track={id:'production-song',providerId:'qa',providerName:'测试音源',pluginId:'qa',ref:{id:'production-song',providerId:'qa',kind:'track'},title:'生产包测试歌曲',artist:'测试歌手',album:'',durationMs:180000,artwork:'/default-cover.png',qualities:['128k']}
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']})
 page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(track=>{
  if(window.top!==window)return
  localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false,playbackCache:false,cloudLyrics:false}))
  localStorage.setItem('ceru.player.v1',JSON.stringify({queue:[track],index:0,volume:1,mode:'list',currentTime:0}))
  localStorage.setItem('ceru.library.v1',JSON.stringify({favorites:[],playlists:[{id:'production-list',name:'我的测试歌单',tracks:[],createdAt:Date.now(),updatedAt:Date.now()}]}))
 },track)
 await page.route('**/*',r=>{
  if(r.request().url().includes('production.audio.test/audio.wav')){
   const valid=r.request().headers()['x-qa-audio']==='required';audioRequests.push({hasRequiredHeader:valid,status:valid?200:403})
   return r.fulfill(valid?{contentType:'audio/wav',body:wav}:{status:403,body:'missing header'})
  }
  return r.request().url().startsWith(base)?r.continue():r.fulfill({status:503,json:{error:'offline production UI test'}})
 })
 await page.goto(base+'/#/settings');await page.locator('.settings-directory').waitFor();assert.match(await page.locator('.phead .ver').innerText(),/2\.7\.6-test\.3/)
 assert.equal(await page.evaluate(()=>typeof window.__ceruDebug),'undefined')
 await page.screenshot({path:out+'/production-version.png'})
 console.log('PASS production Settings shows 2.7.6-test.3; development debug API is absent')
 await page.evaluate(()=>{location.hash='#/plugins'});await page.locator('.market-page').waitFor()
 await page.getByRole('group',{name:'音源格式'}).getByRole('button',{name:'MusicFree',exact:true}).click()
 assert(await page.locator('.catalog-card').count()>0)
 const source="module.exports={platform:'productionqa',name:'生产MusicFree验证',version:'1.0.0',author:'QA',supportedQualities:['128k'],search:async()=>({isEnd:true,data:[{id:'prod-mf',title:'生产MusicFree验证歌曲',artist:'QA',duration:20}]}),getMediaSource:async()=>({url:'https://production.audio.test/audio.wav',headers:{'X-QA-Audio':'required'}}),getLyric:async()=>({rawLrc:'[00:00.00]MusicFree 生产歌词'})}"
 await page.locator('input[type=file]').setInputFiles({name:'qa-musicfree.js',mimeType:'text/javascript',buffer:Buffer.from(source)})
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'安装并启用',exact:true}).click()
 await page.getByText(/生产MusicFree验证 v1.0.0 已安装/).waitFor()
 assert(!(await page.locator('.market-page').innerText()).includes('加载失败'))
 console.log('PASS production importer installs and starts MusicFree through the visible confirmation flow')
 assert.equal(await page.locator('.market-tabs:visible').count(),0)
 assert.equal(await page.locator('.b-platform-list [role=switch]').count(),0)
 await page.screenshot({path:out+'/production-B-使用来源.png'})
 await page.getByRole('tab',{name:'插件管理',exact:true}).click()
 assert.equal(await page.locator('.b-plugin-row [role=switch]').count(),await page.locator('.b-plugin-row').count())
 await page.screenshot({path:out+'/production-B-插件管理.png'})
 await page.getByRole('button',{name:'管理 生产MusicFree验证 插件',exact:true}).click()
 assert.equal(await page.locator('.market-overlay [role=switch]').count(),0)
 await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.market-overlay').waitFor({state:'hidden'})
 console.log('PASS production B management uses platform checkboxes and one switch per plugin; operations live in a separate sheet')
 await page.evaluate(()=>{location.hash='#/search'});await page.getByRole('button',{name:'生产MusicFree验证',exact:true}).click()
 await page.locator('.search-page input').first().fill('生产MusicFree验证歌曲');await page.locator('.search-page input').first().press('Enter')
 await page.locator('.songrow',{hasText:'生产MusicFree验证歌曲'}).first().click({position:{x:100,y:22}})
 await page.evaluate(()=>{location.hash='#/player'});await page.locator('.p-times span').first().filter({hasText:/0:0[1-9]/}).waitFor()
 assert(audioRequests.some(r=>r.status===200));assert(!audioRequests.some(r=>r.status===403))
 assert((await page.locator('.player').innerText()).includes('MusicFree 生产歌词'))
 await page.screenshot({path:out+'/production-musicfree-playing.png'})
 console.log('PASS production MusicFree search -> required-header audio -> advancing playback clock and valid plugin lyrics, using generated WAV')
 await page.getByRole('button',{name:'加入歌单',exact:true}).click()
 await page.getByRole('dialog',{name:'添加到歌单'}).waitFor();await page.waitForTimeout(350)
 await page.screenshot({path:out+'/production-player-playlist.png'})
 await page.locator('.sh-item',{hasText:'我的测试歌单'}).click()
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ceru.library.v1')).playlists[0].tracks[0].id),'prod-mf')
 await page.getByRole('button',{name:'加入歌单',exact:true}).click();await page.locator('.newrow input').fill('生产包新歌单');await page.locator('.newrow button').click()
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ceru.library.v1')).playlists.find(p=>p.name==='生产包新歌单').tracks.length),1)
 console.log('PASS production player directly adds restored current song to existing/new playlists')
 for(const width of [390,768]){
  await page.setViewportSize({width,height:width===390?844:1024});await page.evaluate(()=>{location.hash='#/local'})
  await page.getByRole('button',{name:'扫描设置',exact:true}).click();await page.waitForTimeout(350)
  assert.equal(await page.locator('.filter-mode button').first().evaluate(b=>getComputedStyle(b).textAlign),'center')
  await page.screenshot({path:out+'/production-scan-'+width+'.png'});await page.getByRole('button',{name:'关闭扫描设置'}).click()
 }
 assert.deepEqual(errors,[]);console.log('PASS production phone/tablet scan settings render without page errors')
 fs.writeFileSync(out+'/production-final.json',JSON.stringify({passed:true,version:'2.7.6-test.3',scope:'Actual production dist UI, MusicFree required-header generated-audio playback/lyrics and playlist persistence; not installed Android testing',audioRequests,errors},null,2))
}catch(e){console.error(e);process.exitCode=1;await page?.screenshot({path:out+'/production-failure.png'}).catch(()=>{})}
finally{await browser?.close();server.kill()}
