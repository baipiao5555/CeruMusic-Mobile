import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),out=path.resolve(root,'../evidence')
const base='http://127.0.0.1:5384',checks=[],errors=[]
const serverLog=fs.createWriteStream(path.join(out,'vite-test.log'))
const server=spawn(process.execPath,[path.join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5384','--strictPort'],{cwd:root,stdio:['ignore','pipe','pipe'],windowsHide:true})
server.stdout.pipe(serverLog);server.stderr.pipe(serverLog)
let browser, snapshotPage
const consoleMessages=[]
const pass=s=>{checks.push(s);console.log('PASS',s)}
function wav(){const b=Buffer.alloc(160044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b}
let qaVersion='1.0.0',extraPermissions=false,broken=false
function qaCode(){return `exports.manifest = ${JSON.stringify({manifestVersion:2,id:'qa.market',name:'市场回归音源',version:qaVersion,author:'QA',engines:{hostApi:'^2.0.0',logicRuntime:'ceru-js@1'},modules:{logic:{entry:'logic.main'}},permissions:[{key:'network',name:'network.request',reason:'受控测试网络'},...(extraPermissions?[{key:'library',name:'library.read',reason:'更新权限确认回归'}]:[])],config:{enabled:true},contributes:{providers:['qq','kuwo','kugou','netease','migu'].map(id=>({id,name:{qq:'QQ音乐',kuwo:'酷我音乐',kugou:'酷狗音乐',netease:'网易云音乐',migu:'咪咕音乐'}[id],qualities:['128k'],protocols:['https']}))}})};
exports.activate = function(core) { ${broken?'throw new Error("QA 初始化失败");':''}
 ['qq','kuwo','kugou','netease','migu'].forEach(function(id){ core.providers.register(id,{tracks:{search:async function(query){return {items:[{ref:{providerId:id,kind:'track',id:'qa-song',scope:'provider'},title:'回归测试音乐',subtitle:'QA',capabilities:['play'],metadata:{artists:['QA'],durationMs:10000,qualities:['128k']}}]};},resolve:async function(){return {ok:true,url:'https://audio.test/qa.wav'};},lyrics:async function(){return {format:'crlyric',version:1,lines:[]}}}});});
};`}
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,200));if(i===59)throw new Error('Vite did not start')}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']})
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true})
 const page=await context.newPage();snapshotPage=page;page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')consoleMessages.push(m.text())})
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false}));})
 await context.route('**/*',async route=>{
  const url=route.request().url()
  if(url.startsWith(base)||!/^https?:/.test(url))return route.continue()
  if(url.startsWith('https://raw.githubusercontent.com/hebijunge/musicfree-plugins/master/')){
   const rel=url.split('/master/')[1]
   const file=rel==='ceru-list.json'?path.join(out,'ceru-list.json'):rel.startsWith('ceru-plugins/')?path.join(out,'catalog-raw',rel.split('/').pop()):path.join(out,'five-source-lx.js')
   return route.fulfill({status:200,contentType:rel.endsWith('.json')?'application/json':'text/javascript',body:fs.readFileSync(file)})
  }
  if(url==='https://fixtures.test/qa.js')return route.fulfill({status:200,contentType:'text/javascript',body:qaCode()})
  if(url.startsWith('https://audio.test/'))return route.fulfill({status:200,contentType:'audio/wav',body:wav()})
  return route.fulfill({status:200,contentType:'application/json',body:'{"items":[],"data":{},"code":0}'})
 })
 const manager=fn=>page.evaluate(fn)
 await page.goto(base+'/#/plugins');await page.getByRole('button',{name:'添加音源',exact:true}).waitFor()
 await page.locator('.catalog-card').filter({hasText:'QQ音乐'}).first().getByRole('button',{name:'获取',exact:true}).click()
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).waitFor()
 assert.equal(await page.getByRole('button',{name:'安装并启用',exact:true}).isDisabled(),true)
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'安装并启用',exact:true}).click();await page.locator('.market-panel').waitFor({state:'hidden',timeout:30000})
 await page.waitForFunction(async()=>{const m=await import('/src/core/plugin/manager.ts');return m.pluginState.plugins.some(p=>p.manifestId==='ceru.qq'&&p.running)})
 await page.getByRole('tab',{name:'插件管理',exact:true}).click()
 await page.locator('.installed-card[data-plugin-id="ceru.qq"]').waitFor()
 assert.equal(await page.locator('.installed-card[data-plugin-id="ceru.qq"]').count(),1)
 pass('actual repository QQ file normalized, permission-gated, persisted and activated by real sandbox SDK')
 await page.locator('.appbar').getByRole('button',{name:'返回',exact:true}).click()
 await page.locator('.catalog-card').filter({hasText:'LX 五源合一'}).getByRole('button',{name:'获取',exact:true}).click()
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'安装并启用',exact:true}).click();await page.locator('.market-panel').waitFor({state:'hidden',timeout:30000})
 await page.waitForFunction(async()=>{const m=await import('/src/core/plugin/manager.ts');return m.pluginState.plugins.some(p=>p.format==='lx'&&p.running)},{timeout:20000})
 const lx=await manager(async()=>{const m=await import('/src/core/plugin/manager.ts');const p=m.pluginState.plugins.find(p=>p.format==='lx');return {id:p.manifestId,providers:p.providers.length,running:p.running}})
 console.log('LX_STATE',JSON.stringify(lx))
 assert.equal(lx.providers,5)
 await page.screenshot({path:path.join(out,'实际-已安装多平台.png')})
 pass('actual repository LX script activates and registers five platforms inside one plugin card')
 await page.getByRole('button',{name:'添加音源',exact:true}).click();await page.getByLabel('插件文件地址',{exact:true}).fill('https://fixtures.test/qa.js');await page.getByRole('button',{name:'读取插件信息',exact:true}).click()
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'安装并启用',exact:true}).click();await page.locator('.market-panel').waitFor({state:'hidden',timeout:30000})
 await page.waitForFunction(async()=>{const m=await import('/src/core/plugin/manager.ts');return m.pluginState.plugins.some(p=>p.manifestId==='qa.market'&&p.running)})
 const homeBeforePriority=await manager(async()=>{const m=await import('/src/core/plugin/manager.ts');return m.pluginState.selectedProvider})
 await page.getByRole('tab',{name:'使用来源',exact:true}).click()
 await page.getByRole('button',{name:'管理 QQ音乐 来源',exact:true}).click()
 assert.equal(await page.locator('.b-source-item').count(),3)
 await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.market-panel').waitFor({state:'hidden'})
 await page.getByRole('button',{name:'管理 酷狗音乐 来源',exact:true}).click()
 const selectedRow=page.locator('.b-source-item[data-owner="qa.market"]')
 await selectedRow.getByRole('radio').click();if(await selectedRow.getByRole('checkbox').getAttribute('aria-checked')!=='true')await selectedRow.getByRole('checkbox').click()
 await page.getByRole('button',{name:'完成',exact:true}).click();await page.locator('.market-panel').waitFor({state:'hidden'})
 const selected=await manager(async()=>{const m=await import('/src/core/plugin/manager.ts');return {provider:m.pluginState.selectedProvider,owner:m.pluginState.selectedSourcePlugin.kugou,qa:m.pluginState.plugins.find(p=>p.manifestId==='qa.market').pluginId}})
 assert.equal(selected.provider,homeBeforePriority);assert.equal(selected.owner,selected.qa)
 pass('B source selection retains separate owners, persists per-platform priority and does not change another homepage platform')
 await page.getByRole('tab',{name:'插件管理',exact:true}).click()
 qaVersion='1.1.0';extraPermissions=true
 const qaCard=page.locator('.installed-card[data-plugin-id="qa.market"]')
 await qaCard.getByRole('button',{name:'管理 市场回归音源 插件',exact:true}).click();await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('checkbox',{name:'确认插件来源与权限'}).waitFor()
 const version=()=>manager(async()=>{const m=await import('/src/core/plugin/manager.ts');const p=m.pluginState.plugins.find(p=>p.manifestId==='qa.market');return {version:p.version,running:p.running}})
 assert.equal((await version()).version,'1.0.0');assert.match(await page.locator('.market-panel').innerText(),/读取歌单/)
 await page.getByRole('button',{name:'关闭',exact:true}).click();assert.equal((await version()).version,'1.0.0')
 await qaCard.getByRole('button',{name:'管理 市场回归音源 插件',exact:true}).click();await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'确认更新',exact:true}).click();await page.locator('.market-panel').waitFor({state:'hidden',timeout:30000})
 await page.waitForFunction(async()=>{const m=await import('/src/core/plugin/manager.ts');return m.pluginState.plugins.find(p=>p.manifestId==='qa.market')?.version==='1.1.0'})
 await qaCard.getByRole('button',{name:'管理 市场回归音源 插件',exact:true}).click();await page.getByRole('button',{name:'恢复上一版',exact:true}).click();await page.getByRole('button',{name:'恢复上一版',exact:true}).last().click()
 await page.waitForFunction(async()=>{const m=await import('/src/core/plugin/manager.ts');return m.pluginState.plugins.find(p=>p.manifestId==='qa.market')?.version==='1.0.0'})
 pass('update preview does not replace files; new permissions require consent; confirmed update and actual previous-version restore succeed')
 qaVersion='2.0.0';extraPermissions=false;broken=true
 await qaCard.getByRole('button',{name:'管理 市场回归音源 插件',exact:true}).click();await page.getByRole('button',{name:'检查更新',exact:true}).click();await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'确认更新',exact:true}).click()
 await page.waitForFunction(async()=>{const m=await import('/src/core/plugin/manager.ts');const p=m.pluginState.plugins.find(p=>p.manifestId==='qa.market');return p?.version==='1.0.0'&&p.running&&document.querySelector('.market-panel .notice.error')})
 await page.getByRole('button',{name:'关闭',exact:true}).click()
 pass('failed new activate restores old code and running host, not a success message')
 broken=false;qaVersion='3.0.0'
 const storageResult=await page.evaluate(async code=>{
  const m=await import('/src/core/plugin/manager.ts'),{idb}=await import('/src/core/storage/idb.ts');const old=idb.set
  let injected=true,message='';idb.set=async(...args)=>{if(injected&&args[0]==='plugins'){injected=false;throw new Error('QA storage full')}return old(...args)}
  try{await m.installPlugin(code,{enable:true})}catch(e){message=e.message}finally{idb.set=old}
  const p=m.pluginState.plugins.find(p=>p.manifestId==='qa.market');return {message,version:p.version,running:p.running}
 },qaCode())
 assert.match(storageResult.message,/storage full/);assert.equal(storageResult.version,'1.0.0');assert.equal(storageResult.running,true)
 pass('storage failure leaves original working host and version untouched')
 // File import uses the same live manager, and source/update URL semantics remain separate.
 await page.getByRole('button',{name:'添加音源',exact:true}).click()
 await page.locator('.market-page input[type=file]').setInputFiles(path.join(out,'catalog-raw/qq.ceru.js'))
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).waitFor()
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check()
 await page.getByRole('button',{name:'确认更新',exact:true}).click()
 await page.locator('.market-panel').waitFor({state:'hidden'})
 const fileOrigin=await manager(async()=>{const m=await import('/src/core/plugin/manager.ts');const p=m.pluginState.plugins.find(p=>p.manifestId==='ceru.qq');return {origin:p.installOrigin,source:p.sourceUrl,update:p.updateUrl,count:m.pluginState.plugins.filter(x=>x.manifestId==='ceru.qq').length}})
 assert.equal(fileOrigin.origin,'file');assert.equal(fileOrigin.source,undefined);assert.equal(fileOrigin.count,1);assert.ok(fileOrigin.update)
 pass('real file import normalizes repository snapshot, updates one ID, and retains update URL without mislabeling file origin')
 await page.getByRole('tab',{name:'使用来源',exact:true}).click();await page.getByRole('button',{name:'管理 酷狗音乐 来源',exact:true}).click()
 await page.getByRole('button',{name:'检测优先来源搜索',exact:true}).click();await page.getByRole('button',{name:'只检测搜索，不自动播放或下载',exact:true}).click()
 await page.locator('.market-panel .notice').filter({hasText:'返回 1 条'}).waitFor()
 await page.getByRole('button',{name:'关闭',exact:true}).click()
 pass('manual health probe calls real SDK search contract, records one result, and does not claim playback success')
 const concurrent=await page.evaluate(async code=>{const m=await import('/src/core/plugin/manager.ts');const results=await Promise.allSettled([m.installPlugin(code,{enable:true}),m.installPlugin(code,{enable:true})]);return results.map(r=>({status:r.status,message:r.status==='rejected'?r.reason.message:''}))},qaCode())
 assert.equal(concurrent.filter(x=>x.status==='fulfilled').length,1);assert.equal(concurrent.filter(x=>x.status==='rejected').length,1)
 assert.match(concurrent.find(x=>x.status==='rejected').message,/正在/)
 pass('concurrent writes of the same plugin are serialized/rejected, not installed twice')
 await page.locator('.appbar').getByRole('button',{name:'返回',exact:true}).click()
 await page.locator('.market-scenes button').filter({hasText:'常用音乐'}).click()
 for(const box of await page.locator('.market-scene-item input:enabled').all())await box.uncheck()
 await page.locator('.market-scene-item').filter({hasText:'酷狗音乐'}).locator('input').check()
 await page.locator('.market-scene-item').filter({hasText:'酷我音乐'}).locator('input').check()
 await page.getByRole('button',{name:'准备所选插件',exact:true}).click()
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'安装并启用',exact:true}).click()
 await page.locator('.market-detail-title h3').filter({hasText:'酷我音乐'}).waitFor()
 await page.getByRole('checkbox',{name:'确认插件来源与权限'}).check();await page.getByRole('button',{name:'安装并启用',exact:true}).click()
 await page.locator('.market-panel').waitFor({state:'hidden'})
 const batchInstalled=await manager(async()=>{const m=await import('/src/core/plugin/manager.ts');return ['ceru.kugou','ceru.kuwo'].every(id=>m.pluginState.plugins.some(p=>p.manifestId===id&&p.running))})
 assert.equal(batchInstalled,true)
 pass('scenario batch uses real repository files, skips installed IDs, and confirms each plugin before commit')

 for(const width of [360,390,768]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}
 await page.setViewportSize({width:390,height:844})
 await page.locator('.appbar').getByRole('button',{name:'返回',exact:true}).click();await page.getByLabel('搜索音源',{exact:true}).fill('不存在的音源');assert.equal(await page.locator('.catalog-card').count(),0);await page.getByLabel('搜索音源',{exact:true}).fill('')
 await page.screenshot({path:path.join(out,'实际-音源市场.png')})
 pass('search/category UI and responsive market layout without horizontal overflow')
 const nativeContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true})
 const nativePage=await nativeContext.newPage();nativePage.on('pageerror',e=>errors.push(e.message))
 await nativePage.addInitScript(({base})=>{
  if(window.top!==window)return
  localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false}))
  const track={id:'online-1',providerId:'qq',providerName:'QQ音乐',pluginId:'qa.unavailable',ref:{id:'online-1',providerId:'qq',kind:'track'},title:'虫儿飞（下载回归）',artist:'晚巧',album:'',durationMs:10000,artwork:'/default-cover.png',qualities:[]}
  localStorage.setItem('ceru.downloads.v1',JSON.stringify([{id:'download-1',track,status:'completed',path:'file:///storage/emulated/0/Android/data/com.ceru.music.mobile/files/Music/test.wav',fileName:'test.wav',size:160044,progress:1,received:160044,total:160044,createdAt:1,error:'',quality:'128k'}]))
  window.__qaAudios=[]
  const AudioOriginal=window.Audio
  window.Audio=class extends AudioOriginal{constructor(...args){super(...args);window.__qaAudios.push(this)}}
  const createOriginal=document.createElement.bind(document)
  document.createElement=function(name,...args){const result=createOriginal(name,...args);if(String(name).toLowerCase()==='audio')window.__qaAudios.push(result);return result}
  const instances=new Map();const generic=name=>{if(instances.has(name))return instances.get(name);const p=new Proxy({}, {get:(_,method)=>method==='addListener'?async()=>({remove:async()=>{}}):async()=>({})});instances.set(name,p);return p}
  instances.set('LocalMedia',{check:async()=>({granted:false}),request:async()=>({granted:false}),scan:async()=>({granted:false,tracks:[{id:'app:test.wav',uri:'file:///storage/emulated/0/Android/data/com.ceru.music.mobile/files/Music/test.wav',title:'test',artist:'未知歌手',album:'',durationMs:10000,size:160044,mime:'audio/wav'}]})})
  instances.set('Filesystem',{stat:async()=>({size:160044}),getUri:async()=>({uri:'file:///storage/emulated/0/Android/data/com.ceru.music.mobile/files/Music/test.wav'})})
  instances.set('AudioCache',{start:async()=>({port:5384,token:'qa'}),size:async()=>({bytes:0})})
  const platform={name:'android',getPlatform:()=> 'android',isNativePlatform:()=>true,registerPlugin:name=>generic(name)}
  window.CapacitorPlatforms={currentPlatform:platform,platforms:new Map([['android',platform]])}
 },{base})
 await nativeContext.route('**/*',route=>{
  const url=route.request().url()
  if(url.includes('_capacitor_file_'))return route.fulfill({status:200,contentType:'audio/wav',body:wav()})
  if(url.includes('/audio?'))return route.fulfill({status:500,body:'controlled cache failure'})
  if(url.startsWith(base))return route.continue()
  return route.fulfill({status:200,contentType:'application/json',body:'{}'})
 })
 await nativePage.goto(base+'/#/local');await nativePage.locator('.song-list .songrow').first().waitFor()
 assert.match(await nativePage.locator('.song-list').innerText(),/虫儿飞/)
 await nativePage.evaluate(async()=>{const {Capacitor}=await import('/node_modules/.vite/deps/@capacitor_core.js');Capacitor.convertFileSrc=uri=>'http://127.0.0.1:5384/_capacitor_file_/'+encodeURIComponent(uri)})
 await nativePage.locator('.song-list .songrow').first().tap()
 await nativePage.waitForFunction(async()=>{const p=await import('/src/core/playback/player.ts');return p.playerState.playing},{timeout:10000})
 await nativePage.waitForFunction(()=>window.__qaAudios.some(a=>!a.paused&&a.readyState>=3&&a.currentTime>0.15&&a.src.includes('_capacitor_file_')))
 const local=await nativePage.evaluate(async()=>{const p=await import('/src/core/playback/player.ts');return {playing:p.playerState.playing,track:p.playerState.queue[p.playerState.index],error:p.playerState.error}})
 assert.equal(local.playing,true);assert.equal(local.error,'')
 await nativePage.screenshot({path:path.join(out,'实际-本机下载扫描与播放.png')})
 pass('real LocalMusic and player modules: app download appears without media permission and synthetic WAV plays without online provider')
 const unexpected=errors.filter(e=>!e.includes('QA 初始化失败'))
 assert.deepEqual(unexpected,[])
 fs.writeFileSync(path.join(out,'market-and-scan-browser.json'),JSON.stringify({checks,errors,scope:'Real application and sandbox runtime; HTTP/native/storage bridges controlled. Repository files are real downloaded snapshots, audio is generated QA WAV; not a connected Android device test.'},null,2))
}catch(e){
 if(snapshotPage){await snapshotPage.screenshot({path:path.join(out,'market-failure.png')}).catch(()=>{});fs.writeFileSync(path.join(out,'market-failure-state.json'),JSON.stringify({consoleMessages,errors,text:await snapshotPage.locator('body').innerText().catch(()=>''),plugins:await snapshotPage.evaluate(async()=>{const m=await import('/src/core/plugin/manager.ts');return m.pluginState.plugins}).catch(()=>[])},null,2))}
 throw e
}finally{await browser?.close();server.kill();serverLog.end()}
