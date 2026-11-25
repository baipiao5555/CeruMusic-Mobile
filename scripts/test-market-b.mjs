import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),observe=process.argv.includes('--observe')
const sourceRoot=process.env.CERU_B_SOURCE_ROOT||root,base='http://127.0.0.1:5460',rows=[],errors=[]
const server=spawn(process.execPath,[sourceRoot+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5460','--strictPort'],{cwd:sourceRoot,windowsHide:true})
let browser,page,version='1.0.0'
const platforms=[['qq','QQ音乐'],['kuwo','酷我音乐'],['kugou','酷狗音乐'],['netease','网易云音乐'],['migu','咪咕音乐'],['qishui_music','汽水音乐'],['aggregate','聚合']]
const multiCode=()=>`exports.manifest=${JSON.stringify({manifestVersion:2,id:'qa.b.multi',name:'聆澜音源(赞助版)[永久]',version,engines:{hostApi:'^2.0.0',logicRuntime:'ceru-js@1'},modules:{logic:{entry:'logic.main'}},config:{token:''},contributes:{providers:platforms.map(([id,name])=>({id,name,qualities:['128k'],protocols:['https']}))}})};exports.activate=core=>{${JSON.stringify(platforms)}.forEach(([id,name])=>core.providers.register(id,{tracks:{search:async()=>({items:[]}),resolve:async()=>({ok:true,url:'https://b.test/audio.wav',requestHeaders:{'X-QA':'required'}})}}))}`
const mfCode=(id,name,v)=>`module.exports={platform:'${id}',name:'${name}',author:'B QA',version:'${v}',primaryKey:['id'],supportedQualities:['128k'],search:async()=>({isEnd:true,data:[{id:'song',title:'播放保留验证',artist:'QA',duration:120}]}),getMediaSource:async()=>({url:'https://b.test/audio.wav',headers:{'X-QA':'required'}}),getLyric:async()=>({rawLrc:'[00:00.00]B 布局测试歌词'})}`
const wav=Buffer.alloc(1920044);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40)
const state=()=>page.evaluate(()=>({playing:window.__ceruDebug.player.playerState.playing,home:window.__ceruDebug.pluginState.selectedProvider,search:window.__ceruDebug.searchProviders().map(p=>[p.providerId,p.pluginId]),library:localStorage.getItem('ceru.library.v1')}))
try{
 for(let i=0;i<80;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']})
 page=await browser.newPage({viewport:{width:412,height:906}});page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false,playbackCache:false,cloudLyrics:false}));localStorage.setItem('ceru.library.v1',JSON.stringify({favorites:[],playlists:[{id:'keep',name:'保留歌单',tracks:[]}]}))})
 await page.route('**/*',r=>{const url=r.request().url();if(url.startsWith(base))return r.continue();if(url==='https://b.test/multi.js')return r.fulfill({contentType:'text/javascript',body:multiCode()});if(url==='https://b.test/audio.wav')return r.fulfill({contentType:'audio/wav',body:wav});return r.fulfill({status:503,json:{error:'offline fixture'}})})
 await page.goto(base+'/#/plugins');await page.waitForFunction(()=>window.__ceruDebug&&window.__ceruDebug.pluginState.initialized&&!window.__ceruDebug.pluginState.loading)
 const ids=await page.evaluate(async({multi,lx,mf})=>{
  const d=window.__ceruDebug;for(const p of [...d.pluginState.plugins])await d.removePlugin(p.pluginId)
  const a=await d.installPlugin(multi,{enable:true,grantDeclared:true,sourceUrl:'https://b.test/multi.js',installOrigin:'url'})
  const b=await d.installPlugin(lx,{enable:true,grantDeclared:true});await d.disablePlugin(a.pluginId);await d.disablePlugin(b.pluginId)
  const ids={multi:a.pluginId,lx:b.pluginId}
  for(const [id,code]of mf){const p=await d.installPlugin(code,{enable:true,grantDeclared:true,installOrigin:'market'});ids[id]=p.pluginId}
  for(const p of [...d.pluginState.plugins])if(!Object.values(ids).includes(p.pluginId))await d.removePlugin(p.pluginId)
  const providers=d.allProviders(true),qq=providers.find(p=>p.pluginId===ids.qq),kw=providers.find(p=>p.pluginId===ids.kuwo)
  d.setSearchSources([qq,kw]);d.selectProvider(kw.providerId,kw.pluginId)
  const result=await d.invokeProvider(kw,'tracks.search',[{query:'测试',kinds:['track'],filters:{},limit:20}]);await d.player.playTracks([d.player.toTrack(result.items[0],kw)],0)
  return ids
 },{multi:multiCode(),lx:fs.readFileSync(out+'/five-source-lx.js','utf8'),mf:platforms.slice(0,6).map(([id,name],i)=>[id==='qishui_music'?'qishui':id,mfCode(id==='qishui_music'?'qishui':id,name,['1.9.26','1.9.24','1.9.24','1.9.27','1.9.20','1.9.23'][i])])})
 await page.locator('.market-tabs').getByRole('button',{name:/^已安装/}).click();await page.waitForTimeout(300)
 const before=await state()
 if(observe){
  const result={version:'2.7.6-test.2 baseline',cards:await page.locator('.platform-card').count(),switches:await page.locator('.market-page [role=switch]').count(),qishuiGroups:await page.locator('.platform-card header h3').filter({hasText:'汽水音乐'}).count()}
  await page.screenshot({path:out+'/B-before.png'});rows.push(result);console.log(JSON.stringify(result))
 }else{
  assert.equal(await page.locator('.b-platform-row[data-platform=qishui]').count(),1)
  assert.equal(await page.locator('.market-page [role=switch]').count(),0)
  assert.equal(await page.locator('.market-tabs:visible').count(),0)
  await page.screenshot({path:out+'/B-使用来源-412.png'})
  await page.getByRole('checkbox',{name:'酷狗音乐参与搜索',exact:true}).click()
  let changed=await state();assert(changed.search.some(([id])=>id==='qq'));assert(changed.search.some(([id])=>id==='kuwo'));assert(changed.search.some(([id])=>id==='kugou'));assert.equal(changed.home,before.home);assert(changed.playing)
  console.log('PASS B platform checkboxes are multi-select, no duplicate Qishui group, no plugin switches or duplicate navigation in source view')
  await page.evaluate(id=>{const d=window.__ceruDebug;d.setSearchSources([d.allProviders(true).find(p=>p.pluginId===id)])},ids.kuwo)
  await page.getByRole('checkbox',{name:'酷我音乐参与搜索',exact:true}).click()
  assert.equal((await state()).search.length,1)
  await page.getByRole('button',{name:'管理 酷我音乐 来源',exact:true}).click();await page.waitForTimeout(250)
  assert.equal(await page.locator('.b-source-item').count(),3);assert.equal(await page.getByRole('radio').filter({hasText:'五源合一'}).isEnabled(),false)
  await page.screenshot({path:out+'/B-平台来源.png'})
  await page.locator('.b-source-item[data-owner="qa.b.multi"]').getByRole('button',{name:'去启用',exact:false}).click()
  assert.equal(await page.getByRole('tab',{name:'插件管理',exact:true}).getAttribute('aria-selected'),'true')
  assert.equal(await page.locator('.b-plugin-row').count(),8);assert.equal(await page.locator('.b-plugin-row [role=switch]').count(),8)
  const multi=page.locator('.b-plugin-row[data-plugin-id="qa.b.multi"]')
  await multi.getByRole('switch').click();await page.waitForFunction(id=>window.__ceruDebug.pluginState.plugins.find(p=>p.pluginId===id)?.running,ids.multi)
  await page.getByRole('tab',{name:'使用来源',exact:true}).click();await page.getByRole('button',{name:'管理 酷我音乐 来源',exact:true}).click()
  await page.getByRole('radio',{name:'优先使用 聆澜音源(赞助版)[永久] · 酷我音乐',exact:true}).click()
  assert.equal((await state()).home,'kuwo')
  await page.getByRole('button',{name:'完成',exact:true}).click();await page.waitForTimeout(200)
  await page.getByRole('button',{name:'管理 QQ音乐 来源',exact:true}).click()
  await page.getByRole('radio',{name:'优先使用 聆澜音源(赞助版)[永久] · QQ音乐',exact:true}).click()
  assert.equal((await state()).home,'kuwo');assert((await state()).playing)
  await page.getByRole('button',{name:'完成',exact:true}).click();await page.waitForTimeout(200)
  console.log('PASS same-platform priority is single-select; another platform priority does not change homepage or interrupt playback; disabled source links to its one global switch')
  await page.getByRole('tab',{name:'插件管理',exact:true}).click();await multi.getByRole('button',{name:'管理 聆澜音源(赞助版)[永久] 插件',exact:true}).click();await page.waitForTimeout(200)
  assert.equal(await page.locator('.market-overlay [role=switch]').count(),0)
  await page.screenshot({path:out+'/B-插件更多操作.png'})
  await page.getByRole('button',{name:'插件配置',exact:true}).click();await page.getByRole('textbox',{name:'token',exact:true}).fill('ui-preserved')
  await page.getByRole('button',{name:'保存配置',exact:true}).click();await page.waitForTimeout(200)
  await multi.getByRole('button',{name:'管理 聆澜音源(赞助版)[永久] 插件',exact:true}).click()
  version='1.0.1';await page.getByRole('button',{name:'检查更新',exact:true}).click()
  await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'确认更新',exact:true}).click();await page.waitForTimeout(250)
  assert.equal(await page.evaluate(id=>window.__ceruDebug.pluginState.plugins.find(p=>p.pluginId===id)?.version,ids.multi),'1.0.1')
  assert.equal(await page.evaluate(async id=>(await window.__ceruDebug.getPluginConfig(id)).token,ids.multi),'ui-preserved')
  console.log('PASS one plugin menu retains config and confirmed update flow without duplicating cards or resetting settings')
  await multi.getByRole('button',{name:'管理 聆澜音源(赞助版)[永久] 插件',exact:true}).click()
  await page.getByRole('button',{name:'恢复上一版',exact:true}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'恢复上一版',exact:true}).click();await page.waitForTimeout(250)
  await page.waitForFunction(id=>window.__ceruDebug.pluginState.plugins.find(p=>p.pluginId===id)?.version==='1.0.0',ids.multi)
  assert.equal(await page.evaluate(id=>window.__ceruDebug.pluginState.plugins.find(p=>p.pluginId===id)?.version,ids.multi),'1.0.0')
  await page.locator('.market-overlay').waitFor({state:'hidden'});await page.waitForTimeout(250)
  await page.locator('.b-plugin-row').filter({hasText:'酷狗音乐'}).getByRole('button',{name:'管理 酷狗音乐 插件',exact:true}).click()
  await page.getByRole('button',{name:'卸载插件',exact:true}).click()
  await page.getByRole('alertdialog').getByRole('button',{name:'卸载',exact:true}).click();await page.waitForTimeout(300)
  await page.waitForFunction(id=>!window.__ceruDebug.pluginState.plugins.some(p=>p.pluginId===id),ids.kugou)
  assert.equal(await page.locator('.b-plugin-row').count(),7);assert((await state()).playing)
  console.log('PASS B menu restore and confirmed uninstall preserve unrelated playback and library data')
  for(const width of [360,412,768,1024,1280]){
   await page.setViewportSize({width,height:width>=1024?800:1024});await page.waitForTimeout(120)
   for(const view of ['使用来源','插件管理']){
    await page.getByRole('tab',{name:view,exact:true}).click()
    const metrics=await page.locator('.market-page').evaluate(el=>({overflow:el.scrollWidth>el.clientWidth+1,targets:[...el.querySelectorAll('.b-switch,.b-search-check,.b-plugin-more,.b-platform-summary')].filter(e=>e.getClientRects().length).map(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}))}))
    assert(!metrics.overflow);assert(metrics.targets.every(r=>r.height>=44&&r.width>=44))
    rows.push({width,view,metrics})
    if([412,768].includes(width))await page.screenshot({path:out+`/B-${view}-${width}.png`})
   }
  }
  console.log('PASS B phone/tablet layouts at 360/412/768/1024/1280 widths keep controls reachable and do not overflow')
  const after=await state();assert.equal(after.library,before.library)
  await page.locator('.appbar').getByRole('button',{name:'返回',exact:true}).click();await page.locator('.market-tabs').waitFor({state:'visible'})
  await page.locator('.market-tabs').getByRole('button',{name:/^已安装/}).click()
  await page.reload();await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
  assert.equal((await state()).home,'kuwo');assert.equal(await page.evaluate(id=>window.__ceruDebug.pluginState.selectedSourcePlugin.qq===id,ids.multi),true)
  assert.equal(await page.locator('.b-platform-row[data-platform=qishui]').count(),1)
  console.log('PASS source priorities and management route survive restart; library content unchanged')
  assert.deepEqual(errors,[])
 }
 fs.writeFileSync(out+'/market-b-'+(observe?'before':'after')+'.json',JSON.stringify({pass:true,observe,scope:'Actual Vue/SDK UI with owned plugin fixtures and generated audio; not device testing',rows,errors},null,2))
}catch(e){console.error(e);process.exitCode=1;await page?.screenshot({path:out+'/B-failure.png'}).catch(()=>{})}
finally{await browser?.close();server.kill()}
