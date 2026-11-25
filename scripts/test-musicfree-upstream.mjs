import fs from 'node:fs'
import path from 'node:path'
import {spawn} from 'node:child_process'
import {chromium} from 'playwright-core'
import {transform} from 'esbuild'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),base='http://127.0.0.1:5433'
const server=spawn(process.execPath,[root+'/node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5433','--strictPort'],{cwd:root,windowsHide:true})
let browser;const rows=[]
let oldAdapter
if(process.env.CERU_MF_OLD_RUNTIME_ROOT){
 const text=fs.readFileSync(path.join(process.env.CERU_MF_OLD_RUNTIME_ROOT,'src/core/plugin/musicfree-runtime.ts'),'utf8')
 const transformed=await transform(text,{loader:'ts',format:'esm',target:'chrome87',minify:true})
 oldAdapter=(await import('data:text/javascript;base64,'+Buffer.from(transformed.code).toString('base64'))).installMusicFreeAdapter.toString()
}
try{
 for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 const page=await browser.newPage({viewport:{width:390,height:844}})
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({pluginAutoUpdate:false}))})
 await page.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.fulfill({status:503,json:{error:'offline initialization test'}}))
 await page.goto(base+'/#/plugins');await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
 for(const file of fs.readdirSync(out+'/musicfree-sources')){
  const code=fs.readFileSync(out+'/musicfree-sources/'+file,'utf8')
  const started=Date.now()
  const result=await page.evaluate(async({code,oldAdapter})=>{
    try{
      const d=window.__ceruDebug
      if(oldAdapter){
       const {installMusicFreeAdapter}=await import('/src/core/plugin/musicfree-runtime.ts')
       const prepared=await d.preparePluginCode(code),current='('+installMusicFreeAdapter.toString()+')'
       if(!prepared.includes(current))throw new Error('Current wrapper was not found')
       code=prepared.replace(current,'('+oldAdapter+')')
      }
      const p=await d.installPlugin(code,{enable:true,grantDeclared:true});const output={pass:true,name:p.name,format:p.format,methods:p.providers.flatMap(x=>x.methods),legacyAdapter:Boolean(oldAdapter)};await d.removePlugin(p.pluginId);return output
    }
    catch(e){return {pass:false,error:e.message||String(e)}}
  },{code,oldAdapter})
  rows.push({file,durationMs:Date.now()-started,...result});console.log(JSON.stringify(rows.at(-1)))
 }
 const result={scope:'57 pinned real upstream scripts initialized in the actual SDK/CSP Worker. External APIs are deliberately offline; this is not an online playback assertion.',passed:rows.filter(x=>x.pass).length,failed:rows.filter(x=>!x.pass).length,rows}
 fs.writeFileSync(out+(oldAdapter?'/musicfree-upstream-legacy-startup.json':'/musicfree-upstream-startup.json'),JSON.stringify(result,null,2))
 console.log('UPSTREAM STARTUP',result.passed,'/',rows.length)
 if(result.failed)process.exitCode=1
}finally{await browser?.close();server.kill()}
