import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const out=process.env.CERU_QA_DIR||path.resolve(repo,'../CeruMusic-Mobile-账号主题与同步-2026-11-16/evidence/accounts')
await fs.mkdir(out,{recursive:true})
const {chromium}=createRequire(path.join(repo,'package.json'))('playwright-core')
const {readPluginArtifact}=await import('@shiqianjiang/ceru-plugin-core')
const files=['src/views/Accounts.vue','src/components/PluginAccountSurface.vue','src/core/plugin/accountSurface.ts','src/core/plugin/manager.ts','src/core/plugin/host.ts','src/core/native/secureStore.ts']
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(repo,f))).digest('hex')])));
const before=await hashes(),checks=[],errors=[],external=[]
const check=(name,actual,expected)=>{assert.deepEqual(actual,expected,name);checks.push({name,result:'PASS',actual});console.log('PASS '+name)}
function fixture(suffix){
 const manifest={manifestVersion:2,id:'qa.account.'+suffix.toLowerCase(),name:'QA音源 '+suffix,version:'1.0.0',engines:{hostApi:'^2.0.0',logicRuntime:'ceru-js@1'},modules:{logic:{entry:'logic.main'},surfaces:[{id:'native-login',kind:'native',entry:'account.view',lifecycle:{openAction:'account.open',closeAction:'account.close'}},{id:'web-login',kind:'web',entry:'ui.web',lifecycle:{openAction:'account.open',closeAction:'account.close'}}]},permissions:[{key:'profile',name:'account.profile',reason:'QA scoped public profile'}],contributes:{providers:[{id:'tx',name:'QQ音乐（QA）',protocols:['https'],connectionMode:'single'}],commands:['state','view','open','close','signin','logout','counts','profile'].map(id=>({id:'account.'+id,title:id,action:'account.'+id})),accountItems:[{id:'native',title:'QA账号 '+suffix,view:'native-login',action:'account.state',logoutAction:'account.logout'},{id:'web',title:'QA网页账号 '+suffix,view:'web-login',action:'account.state',logoutAction:'account.logout'}]}}
 return `exports.manifest=${JSON.stringify(manifest)};
exports.activate=async function(core){let signed=!!(await core.storage.get('signed'));let opened=0,closed=0;
core.actions.register('account.state',async()=>({signedIn:signed,displayName:'QA用户 ${suffix}',token:'qa-secret-must-not-leak'}));
core.actions.register('account.view',async()=>({type:'page',title:'QA原生登录 ${suffix}',description:'受控测试，不是真实平台账号',actions:[{label:'测试连接 ${suffix}',action:'account.signin',primary:true}],sections:[]}));
core.actions.register('account.open',async()=>{opened++});core.actions.register('account.close',async()=>{closed++});
core.actions.register('account.signin',async()=>{await core.storage.set('token','qa-private-session');await core.storage.set('signed',true);signed=true;return null});
core.actions.register('account.logout',async()=>{signed=false;await core.storage.delete('signed');await core.storage.delete('token');return null});
core.actions.register('account.counts',async()=>({opened,closed}));
core.actions.register('account.profile',async(_,op)=>core.account.getSession({permissionKey:'profile',operation:op}));};
exports.surfaces={'web-login':function(ctx){const b=document.createElement('button');b.textContent='网页测试连接 ${suffix}';b.id='qa-web-login';b.onclick=async()=>{await ctx.invoke('account.signin',{});await ctx.close()};ctx.root.append(b);}};`
}
const a=fixture('A'),b=fixture('B');readPluginArtifact(a);readPluginArtifact(b)
await fs.writeFile(path.join(out,'fixture-A.js'),a);await fs.writeFile(path.join(out,'fixture-B.js'),b)
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
let fatal,page
try{
 page=await browser.newPage({viewport:{width:362,height:804}})
 await page.addInitScript(()=>{if(window.top!==window)return;localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}));localStorage.setItem('ceru.settings.v1',JSON.stringify({logsEnabled:false,verboseLogs:false,pluginAutoUpdate:false}))})
 await page.route('**/*',async route=>{const u=route.request().url();if(u.startsWith('http://127.0.0.1:5199')||u.startsWith('data:')||u.startsWith('blob:'))return route.continue();external.push(u);await route.abort()})
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://127.0.0.1:5199/#/accounts',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.__ceruDebug&&!window.__ceruDebug.pluginState.loading)
 check('all required platform choices visible',await page.locator('.account-platforms button').allTextContents().then(t=>['澜音','QQ音乐','酷狗音乐','酷我音乐'].every(x=>t.includes(x))),true)
 await page.locator('.account-platforms').getByRole('button',{name:'QQ音乐',exact:true}).click()
 check('no fake platform login without source',await page.locator('.platform-status').innerText().then(t=>t.includes('尚未安装')),true)
 check('no login entries fabricated',await page.locator('.plugin-account').count(),0)
 await page.screenshot({path:path.join(out,'accounts-no-source-362.png')})
 const selected=await page.evaluate(()=>window.__ceruDebug.pluginState.selectedProvider)
 const ids=await page.evaluate(async({a,b})=>{const d=window.__ceruDebug;await d.installPlugin(a,{enable:true,grantDeclared:true});await d.installPlugin(b,{enable:true,grantDeclared:true});return Object.fromEntries(['A','B'].map(k=>[k,d.pluginState.plugins.find(p=>p.manifestId==='qa.account.'+k.toLowerCase()).pluginId]))},{a,b})
 await page.waitForFunction(()=>document.querySelectorAll('.plugin-account').length===4)
 const card=k=>page.locator('.plugin-account').filter({has:page.getByRole('heading',{name:'QA账号 '+k,exact:true})})
 await page.waitForFunction(()=>document.body.textContent.includes('未连接 · QA用户 A'))
 check('public summary drops unexpected secret field',await page.evaluate(async id=>Object.keys(await window.__ceruDebug.pluginAccountSummary(id,'native')).sort(),ids.A),['displayName','signedIn'])
 await card('A').getByRole('button',{name:'打开登录界面',exact:true}).click();await page.getByRole('dialog',{name:'QA账号 A'}).waitFor()
 await page.getByRole('button',{name:'测试连接 A',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.account-surface button')).some(b=>b.textContent==='测试连接 A'&&!b.disabled)&&document.body.textContent.includes('已连接 · QA用户 A'))
 await page.getByRole('button',{name:'关闭账号界面',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('已连接 · QA用户 A'))
 check('real native Surface open/close once',await page.evaluate(id=>window.__ceruDebug.invokePluginAccountAction(id,'native','account.counts',{}),ids.A),{opened:1,closed:1})
 check('other plugin remains logged out',await page.evaluate(id=>window.__ceruDebug.pluginAccountSummary(id,'native').then(s=>s.signedIn),ids.B),false)
 const privacy=await page.evaluate(async()=>{const {idb}=await import('/src/core/storage/idb.ts');return{ls:Object.values(localStorage).join(''),idb:JSON.stringify(await idb.all('pluginStorage'))}})
 check('platform token not written into localStorage',privacy.ls.includes('qa-private-session'),false)
 check('platform token not written into plain IndexedDB',privacy.idb.includes('qa-private-session'),false)
 const keys=await page.evaluate(async({a,b})=>{const source=await fetch('/src/core/plugin/host.ts').then(r=>r.text()),url=source.match(/from\s+["']([^"']*\/native\/secureStore\.ts[^"']*)["']/)[1],{secureStore}=await import(url);const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('token'));const key=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');return {a:await secureStore.get('plugin.account.'+a,key),b:await secureStore.get('plugin.account.'+b,key),status:await secureStore.status()}},{a:ids.A,b:ids.B})
 check('secure session namespace stores own token',keys.a,'"qa-private-session"');check('other owner cannot see token',keys.b,null);check('browser storage honestly session-only',keys.status.persistent,false)
 await card('B').getByRole('button',{name:'打开登录界面',exact:true}).click();await page.getByRole('button',{name:'测试连接 B',exact:true}).click();await page.waitForFunction(()=>Array.from(document.querySelectorAll('.account-surface button')).some(b=>b.textContent==='测试连接 B'&&!b.disabled)&&document.body.textContent.includes('已连接 · QA用户 B'));await page.getByRole('button',{name:'关闭账号界面',exact:true}).click()
 await page.evaluate(()=>{const a=window.__ceruDebug.auth.authState;a.authenticated=true;a.user={sub:'qa-host-sub',nickname:'QA澜音用户'}})
 const profiles=await page.evaluate(async ids=>{const d=window.__ceruDebug;return {a:await d.invokePluginAccountAction(ids.A,'native','account.profile',{}),b:await d.invokePluginAccountAction(ids.B,'native','account.profile',{})}},ids)
 check('host own account service returns loggedIn',profiles.a.loggedIn,true);check('plugin-scoped host profile identity',profiles.a.profile.identityScope,'plugin');check('different plugin gets different public identity',profiles.a.profile.id===profiles.b.profile.id,false);check('host identity is not raw auth subject',profiles.a.profile.id==='qa-host-sub',false)
 const tokens=await page.evaluate(async ids=>{const m=await import('/src/core/resourceNavigation.ts');const d=window.__ceruDebug;const owner=k=>d.allProviders(true).find(p=>p.pluginId===ids[k]);return{a:m.retainResource(owner('A'),{ref:{id:'qa-private-A',kind:'playlist',connectionId:'private-A'},title:'QA'},''),b:m.retainResource(owner('B'),{ref:{id:'qa-private-B',kind:'playlist',connectionId:'private-B'},title:'QA'},'')}},ids)
 await card('A').getByRole('button',{name:'退出此账号',exact:true}).click();await page.getByRole('button',{name:'退出',exact:true}).click();await page.waitForFunction(()=>document.body.textContent.includes('未连接 · QA用户 A'))
 check('logout A leaves platform B session intact',await page.evaluate(id=>window.__ceruDebug.pluginAccountSummary(id,'native').then(s=>s.signedIn),ids.B),true)
 check('platform logout does not log out Ceru',await page.evaluate(()=>window.__ceruDebug.auth.authState.authenticated),true)
 check('logout invalidates only owner private navigation',await page.evaluate(async tokens=>{const m=await import('/src/core/resourceNavigation.ts');return [!!m.resourceContext(tokens.a),!!m.resourceContext(tokens.b)]},tokens),[false,true])
 const webCard=page.locator('.plugin-account').filter({has:page.getByRole('heading',{name:'QA网页账号 A',exact:true})})
 await webCard.getByRole('button',{name:'打开登录界面',exact:true}).click();await page.locator('.account-surface iframe').waitFor();const web=page.frameLocator('.account-surface iframe');await web.getByRole('button',{name:'网页测试连接 A',exact:true}).waitFor()
 check('web surface has opaque sandbox',await page.locator('.account-surface iframe').getAttribute('sandbox'),'allow-scripts')
 const frame=await (await page.locator('.account-surface iframe').elementHandle()).contentFrame()
 check('web surface cannot read parent DOM',await frame.evaluate(()=>{try{return !!parent.document}catch{return false}}),false)
 check('web rejects undeclared action',await frame.evaluate(()=>globalThis.__ceruContext.invoke('not.declared',{}).then(()=>false,()=>true)),true)
 await web.getByRole('button',{name:'网页测试连接 A',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.account-surface'))
 check('web action actually changes account state',await page.evaluate(id=>window.__ceruDebug.pluginAccountSummary(id,'native').then(s=>s.signedIn),ids.A),true)
 check('web lifecycle also exactly once',await page.evaluate(id=>window.__ceruDebug.invokePluginAccountAction(id,'native','account.counts',{}),ids.A),{opened:2,closed:2})
 check('global music source not changed by accounts',await page.evaluate(()=>window.__ceruDebug.pluginState.selectedProvider),selected)
 for(const [w,h] of [[360,640],[362,804]]){await page.setViewportSize({width:w,height:h});check('account no horizontal overflow '+w,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(out,'accounts-connected-'+w+'.png')})}
 await page.evaluate(id=>window.__ceruDebug.disablePlugin(id),ids.A);await page.waitForFunction(()=>document.querySelectorAll('.plugin-account').length===2)
 check('disabled source accounts disappear',await page.locator('.plugin-account').count(),2)
 check('no real remote login/API called',external,[]);check('no page errors',errors,[]);check('tested source hashes unchanged',await hashes(),before)
}catch(e){fatal=e.stack||String(e);console.error(fatal);if(page){await page.screenshot({path:path.join(out,'account-failure.png')});const frames=await Promise.all(page.frames().map(async f=>({url:f.url(),info:await f.evaluate(()=>({text:document.body?.innerText,context:!!globalThis.__ceruContext,started:typeof globalThis.__ceruStart})).catch(e=>({error:e.message}))})));await fs.writeFile(path.join(out,'account-failure-frames.json'),JSON.stringify(frames,null,2))}}finally{await browser.close();const result={result:fatal?'FAIL':'PASS',exitCode:fatal?1:0,scope:'Real Vue, official SDK logic iframe, native/web Surface and session-memory secureStore; fabricated QA identities only, not real platform login or Android Keystore validation.',checks,errors,external,sourceHashes:before,fatal};await fs.writeFile(path.join(out,'account-center-qa.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({result:result.result,pass:checks.length,exitCode:result.exitCode}));process.exitCode=result.exitCode}
