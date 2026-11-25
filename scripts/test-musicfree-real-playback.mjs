import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),base='http://127.0.0.1:5452',rows=[],http=[]
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5452','--strictPort'],{cwd:root,windowsHide:true})
let browser,current=''
const scrub=url=>{const u=new URL(url);for(const key of u.searchParams.keys())if(/token|key|auth|sign|cookie|uin/i.test(key))u.searchParams.set(key,'REDACTED');return u.toString()}
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']})
 const page=await browser.newPage({viewport:{width:412,height:906}})
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false,playbackCache:false,cloudLyrics:false,quality:'128k'}))})
 await page.route('**/*',async r=>{
  const request=r.request(),url=request.url();if(url.startsWith(base))return r.continue()
  if(!current||/github|jsdelivr/.test(new URL(url).hostname))return r.fulfill({status:503,json:{error:'only source APIs tested'}})
  // Requests first pass the real Host URL/permission guard. Node forwards only public HTTP endpoints for browser CORS-neutral testing.
  const u=new URL(url)
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||/localhost|\.local$|^(?:127|10|192\.168)\./i.test(u.hostname))return r.abort('blockedbyclient')
  const record={source:current,url:scrub(url),method:request.method(),headerNames:Object.keys(request.headers()),range:request.headers().range,resourceType:request.resourceType()};http.push(record)
  try{
   const headers={...request.headers()};delete headers.host;delete headers['content-length'];delete headers['accept-encoding']
   const response=await fetch(url,{method:request.method(),headers,body:['GET','HEAD'].includes(request.method())?undefined:request.postData(),signal:AbortSignal.timeout(20000)})
   const body=Buffer.from(await response.arrayBuffer());if(body.length>24*1024*1024)throw new Error('QA response exceeds 24 MiB')
   record.status=response.status;record.mime=response.headers.get('content-type');record.bytes=body.length;record.contentRange=response.headers.get('content-range')
   if(!/audio|octet-stream/i.test(record.mime||''))record.preview=body.toString('utf8',0,180).replace(/\s+/g,' ')
   const relayHeaders={};for(const name of ['content-range','accept-ranges','content-length'])if(response.headers.get(name))relayHeaders[name]=response.headers.get(name)
   return r.fulfill({status:response.status,body,contentType:record.mime||'application/octet-stream',headers:relayHeaders})
  }catch(e){record.error=e.message;return r.fulfill({status:502,json:{error:'QA public network request failed'}})}
 })
 await page.goto(base+'/#/plugins');await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
 for(const file of ['kuwo-source.plugin.v1.9.24.js','qq-source.plugin.v1.9.26.js','kugou-source.plugin.v1.9.24.js'].filter(f=>!process.env.CERU_LIVE_SOURCE||f.startsWith(process.env.CERU_LIVE_SOURCE))){
  current=file;const start=http.length
  const result=await page.evaluate(async code=>{
   const d=window.__ceruDebug;let installed
   try{
    installed=await d.installPlugin(code,{enable:true,grantDeclared:true});const p=d.allProviders(true).find(p=>p.pluginId===installed.pluginId)
    const page=await d.invokeProvider(p,'tracks.search',[{query:'雨爱 杨丞琳',kinds:['track'],filters:{},limit:20}])
    const entity=page.items.find(t=>t.title==='雨爱'&&t.metadata?.artists?.some(a=>a.includes('杨丞琳')))||page.items[0]
    if(!entity)throw new Error('Live search returned no songs')
    const resolved=await d.invokeProvider(p,'tracks.resolve',[entity.ref,'128k'])
    if(!resolved.ok)throw new Error(resolved.error?.message||'No URL')
    const preview={title:entity.title,artists:entity.metadata.artists,id:entity.ref.id,sourceUrl:new URL(resolved.url).origin+new URL(resolved.url).pathname,requestHeaderNames:Object.keys(resolved.requestHeaders||{}),rangeHeader:resolved.requestHeaders?.Range||resolved.requestHeaders?.range}
    d.player.playerState.quality='128k'
    try{await d.player.playTracks([d.player.toTrack(entity,p)],0)}catch(e){return {pass:false,...preview,error:e.message}}
    await new Promise(r=>setTimeout(r,700))
    return {pass:d.player.playerState.playing&&d.player.playerState.currentTime>0,...preview,currentTime:d.player.playerState.currentTime}
   }catch(e){return {pass:false,error:e.message||String(e)}}finally{if(d.player.playerState.playing)await d.player.togglePlay();if(installed)await d.removePlugin(installed.pluginId)}
  },fs.readFileSync(out+'/musicfree-sources/'+file,'utf8'))
  rows.push({file,...result,requests:http.slice(start)});console.log(file,JSON.stringify(result))
 }
}catch(e){console.error(e);process.exitCode=1}
finally{fs.writeFileSync(out+'/musicfree-real-playback.json',JSON.stringify({scope:'Actual pinned upstream scripts, real public metadata/media APIs and real browser audio; Node public-network relay neutralizes browser CORS, not an Android device test',rows,http},null,2));await browser?.close();server.kill()}
