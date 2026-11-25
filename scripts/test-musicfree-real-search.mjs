import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),base='http://127.0.0.1:5435',rows=[],requests=[]
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5435','--strictPort'],{cwd:root,windowsHide:true})
let browser,current=''
const title='受控搜索歌曲',qq={id:101,songid:101,mid:'qa101',songmid:'qa101',name:title,songname:title,singer:[{id:1,name:'测试歌手'}],album:{id:1,mid:'album1',name:'测试专辑',title:'测试专辑'},albummid:'album1',interval:120,file:{media_mid:'qa101'},pay:{pay_play:0}}
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:390,height:844}})
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false,playbackCache:false}))})
 await page.route('**/*',r=>{
  const url=r.request().url();if(url.startsWith(base))return r.continue()
  if(!current)return r.fulfill({status:503,json:{error:'offline initialization'}})
  requests.push({source:current,url,method:r.request().method(),body:r.request().postData()})
  const songList={list:[qq],totalnum:1},payload={code:0,data:{song:songList,body:{song:songList},list:[qq]},req:{code:0,data:{body:{song:songList}}},req_1:{code:0,data:{body:{song:songList}}},search:{code:0,data:{body:{song:songList}}}}
  // QQ gateways name the request module dynamically.
  let args={};try{args=JSON.parse(r.request().postData()||new URL(url).searchParams.get('data')||'{}')}catch{}
  for(const key of Object.keys(args))if(key!=='comm')payload[key]={code:0,data:{body:{song:songList},song:songList}}
  return r.fulfill({json:payload})
 })
 await page.goto(base+'/#/plugins');await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
 for(const file of ['qq-source.plugin.v1.9.26.js']){
  current=file;const start=requests.length
  const result=await page.evaluate(async code=>{
   const d=window.__ceruDebug;let installed
   try{installed=await d.installPlugin(code,{enable:true,grantDeclared:true});const p=d.allProviders(true).find(p=>p.pluginId===installed.pluginId);return {pass:true,result:await d.invokeProvider(p,'tracks.search',[{query:'测试',kinds:['track'],filters:{},limit:20}])}}
   catch(e){return {pass:false,error:e.message||String(e)}}finally{if(installed)await d.removePlugin(installed.pluginId)}
  },fs.readFileSync(out+'/musicfree-sources/'+file,'utf8'))
  rows.push({file,...result,requests:requests.slice(start)});console.log(JSON.stringify(rows.at(-1)))
  assert(result.pass&&result.result.items.length===1, file+' must convert a controlled actual upstream search response')
  assert.equal(result.result.items[0].title,title)
 }
 console.log('PASS pinned real QQ MusicFree script: actual SDK Worker search converts a controlled QQ gateway response (not online playback)')
}catch(e){console.error(e);process.exitCode=1}
finally{fs.writeFileSync(out+'/musicfree-real-search.json',JSON.stringify({scope:'Pinned real upstream scripts with controlled remote responses; not online source availability',rows,requests},null,2));await browser?.close();server.kill()}
