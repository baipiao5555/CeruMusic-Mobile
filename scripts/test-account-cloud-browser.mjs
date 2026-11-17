import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'

const root=path.resolve(import.meta.dirname,'..'),out=process.env.CERU_QA_DIR||path.resolve(root,'../../../verification/browser')
const base=process.env.CERU_QA_BASE||'http://127.0.0.1:5299'
await mkdir(out,{recursive:true})
const {chromium}=createRequire(path.join(root,'package.json'))('playwright-core')
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const checks=[],errors=[],requests=[]
let remote=Array.from({length:500},(_,i)=>({songmid:String(i),source:'fixture',name:'测试歌曲 '+i,singer:'QA',pos:(i+1)*2}))
let updatedAt='2026-11-16T00:00:00Z',businessError=false,fatal
try {
 const page=await browser.newPage({viewport:{width:390,height:844}})
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{
  if(window.top!==window)return
  if(!localStorage.getItem('ceru.auth.v1'))localStorage.setItem('ceru.auth.v1',JSON.stringify({accessToken:'synthetic-browser-test',expiresAt:Date.now()+3600000,user:{sub:'fixture-A',name:'离线测试账号'}}))
  localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}))
 })
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url())
  if(url.hostname==='api.ceru.shiqianjiang.cn'){
   requests.push({path:url.pathname,pos:url.searchParams.get('pos')})
   let data
   if(url.pathname.endsWith('/user-songlist'))data=[{id:'cloud',name:'同步回归歌单',updatedAt}]
   else if(businessError)data={code:500,data:null,message:'模拟业务错误'}
   else {const list=remote.filter(t=>!url.searchParams.has('pos')||t.pos>Number(url.searchParams.get('pos'))).slice(0,200);data={code:200,data:{list,total:remote.length}}}
   return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)})
  }
  if(url.hostname==='127.0.0.1')return route.continue()
  return route.abort()
 })
 await page.goto(base+'/#/cloud')
 const all=page.getByRole('button',{name:'全部导入',exact:true})
 await all.waitFor();await all.click()
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ceru.library.v1')||'{}').playlists?.[0]?.tracks.length===500)
 const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('ceru.library.v1')))
 assert.equal(new Set(first.playlists[0].tracks.map(t=>t.id)).size,500)
 checks.push({name:'actual browser import500 exact distinct songs',result:'PASS'})
 await page.goto(base+'/#/cloud')
 await page.getByRole('button',{name:'更新',exact:true}).waitFor()
 await page.evaluate(async()=>{
  const l=await import('/src/core/library.ts'),p=l.libraryState.playlists[0]
  l.addTrackToPlaylist(p.id,{id:'phone-only',providerId:'fixture',pluginId:'',providerName:'Fixture',title:'手机新增',artist:'QA',album:'',durationMs:0,artwork:'',qualities:[],ref:{id:'phone-only',providerId:'fixture',kind:'track',scope:'provider'}})
 })
 remote.push({songmid:'remote-new',source:'fixture',name:'电脑新增',singer:'QA',pos:1002});updatedAt='2026-11-16T01:00:00Z'
 await page.getByRole('button',{name:'更新',exact:true}).click()
 await page.getByRole('alertdialog').waitFor()
 assert.equal(await page.getByRole('button',{name:'更新',exact:true}).isDisabled(),true)
 await page.getByRole('button',{name:'保留本机歌单',exact:true}).click()
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ceru.library.v1')).playlists[0].tracks.some(t=>t.id==='phone-only')),true)
 checks.push({name:'cancel confirmation preserves local additions and holds busy',result:'PASS'})
 await page.getByRole('button',{name:'更新',exact:true}).click()
 await page.getByRole('button',{name:'用云端版本覆盖',exact:true}).click()
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('ceru.library.v1')).playlists[0].tracks.some(t=>t.id==='remote-new'))
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ceru.library.v1')).playlists[0].tracks.some(t=>t.id==='phone-only')),false)
 checks.push({name:'explicit confirmation applies complete cloud snapshot501',result:'PASS'})
 const before=await page.evaluate(()=>localStorage.getItem('ceru.library.v1'))
 businessError=true
 await page.getByRole('button',{name:'更新',exact:true}).click()
 await page.getByText('模拟业务错误',{exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>localStorage.getItem('ceru.library.v1')),before)
 checks.push({name:'HTTP200 business error shown and stored playlist remains unchanged',result:'PASS'})
 businessError=false
 await page.reload();await page.getByRole('button',{name:'更新',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('ceru.library.v1')).playlists[0].tracks.length),501)
 assert.equal(errors.length,0)
 checks.push({name:'reload persists501 songs without browser runtime errors',result:'PASS'})
 await page.screenshot({path:path.join(out,'cloud-sync-fixed.png'),fullPage:true})
} catch(e){fatal=e.stack||String(e);console.error(fatal)}
finally {await browser.close();await writeFile(path.join(out,'browser-regression.json'),JSON.stringify({scope:'real Chrome Vue UI; synthetic session and locally intercepted cloud requests; no real account',checks,errors,requests,fatal,exitCode:fatal?1:0},null,2));console.log(JSON.stringify({checks:checks.length,result:fatal?'FAIL':'PASS'}));process.exitCode=fatal?1:0}
