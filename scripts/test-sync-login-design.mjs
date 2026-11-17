import {chromium} from 'playwright-core'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
const root=path.resolve(import.meta.dirname,'..'),out=process.env.CERU_QA_OUT,base=process.env.CERU_QA_BASE||'http://127.0.0.1:5321'
if(!out)throw Error('CERU_QA_OUT required')
await mkdir(out,{recursive:true})
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
const checks=[],errors=[]
try{
 const page=await browser.newPage({viewport:{width:390,height:844}})
 page.on('pageerror',e=>errors.push(e.message))
 await page.addInitScript(()=>{if(window.top===window)localStorage.setItem('ceru.update.v1',JSON.stringify({autoCheck:false}))})
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort())
 const check=(name,value)=>{checks.push({name,pass:value});assert(value,name)}
 for(const [width,height] of [[360,640],[390,844],[412,915]]){
  await page.setViewportSize({width,height});await page.goto(base+'/#/sync-services');await page.getByRole('heading',{name:'同步服务',exact:true}).waitFor()
  check('compact cards, no expanded form '+width,await page.locator('.service-row').count()===4&&!await page.getByRole('dialog').count())
  check('no horizontal overflow '+width,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  await page.screenshot({path:path.join(out,'sync-cards-'+width+'.png'),fullPage:true})
  await page.getByRole('button',{name:'添加连接',exact:true}).click();await page.getByRole('dialog',{name:'添加 WebDAV 连接'}).waitFor()
  check('one safe configuration dialog '+width,await page.getByRole('dialog').count()===1&&await page.getByRole('button',{name:'保存安全连接',exact:true}).isDisabled())
  await page.screenshot({path:path.join(out,'sync-form-'+width+'.png'),fullPage:true})
  await page.getByRole('button',{name:'关闭连接配置'}).click()
 }
 await page.evaluate(()=>{document.documentElement.classList.add('dark');document.documentElement.dataset.theme='dark'})
 await page.screenshot({path:path.join(out,'sync-dark-412.png'),fullPage:true})
 check('dark cards retain contrast',await page.locator('.service-list').evaluate(e=>getComputedStyle(e).backgroundColor!=='rgb(255, 255, 255)'))
 const java=await readFile(root+'/android/app/src/main/java/com/ceru/music/mobile/PlatformLoginPlugin.java','utf8')
 const xml=await readFile(root+'/android/app/src/main/res/layout/platform_login.xml','utf8')
 const css=await readFile(root+'/android/app/src/main/res/raw/platform_auth_mobile.css','utf8')
 check('native shell uses themed resource, not default gray button pair',java.includes('inflate(R.layout.platform_login')&&xml.includes('@drawable/platform_login_primary')&&!java.includes('cancel.setText'))
 check('QQ direct official mobile authorization, with compatibility option',java.includes('graph.qq.com/oauth2.0/show')&&java.includes('desktop ? "pc" : "mobile"')&&java.includes('WebSettings.getDefaultUserAgent'))
 check('no password handling or native bridge added',!java.includes('addJavascriptInterface')&&!java.includes('getElementById(\'p\')'))
 check('TLS and navigation boundaries retained',java.includes('handler.cancel()')&&java.includes('MIXED_CONTENT_NEVER_ALLOW')&&java.includes('setInstanceFollowRedirects(false)'))
 check('style does not hide authorization/captcha controls',!css.includes('display: none')&&!css.includes('visibility: hidden'))
 check('no browser errors',errors.length===0)
}catch(e){errors.push(e.stack);process.exitCode=1}
finally{await browser.close();await writeFile(path.join(out,'sync-login-design-check.json'),JSON.stringify({scope:'actual Vue/Chrome screenshots; native XML/Java static checks only, not Android runtime',checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors,pass:!errors.length}))}
