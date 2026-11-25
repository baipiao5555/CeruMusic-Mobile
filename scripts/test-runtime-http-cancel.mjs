import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {transform} from 'esbuild'
import {execFileSync} from 'node:child_process'
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'../evidence'),observe=process.argv.includes('--observe')
const source=observe?execFileSync('git',['show','HEAD:src/core/plugin/runtimeCompat.ts'],{cwd:root,encoding:'utf8'}):fs.readFileSync(root+'/src/core/plugin/runtimeCompat.ts','utf8')
const result=await transform(source,{loader:'ts',format:'esm'})
const {installRuntimeCompatibility}=await import('data:text/javascript;base64,'+Buffer.from(result.code).toString('base64'))
let provider,release;const gate=new Promise(r=>release=r),requests=[]
const core={providers:{register:(_id,impl)=>provider=impl},http:{request:input=>new Promise((_resolve,reject)=>{
 const row={id:input.operation?.id,aborted:false,reject};requests.push(row)
 input.operation?.signal?.addEventListener('abort',()=>{row.aborted=true;reject(new Error('cancelled'))},{once:true})
}),create:()=>({})}}
installRuntimeCompatibility(core)
core.providers.register('qa',{tracks:{
 search:async(_request,op)=>{await gate;return core.http.request({url:'https://api.test/search'})},
 resolve:async(_ref,_quality,op)=>{await gate;return core.http.request({url:'https://api.test/source'})}
}})
const a=new AbortController(),b=new AbortController()
const pending=Promise.allSettled([provider.tracks.search({}, {id:'search',signal:a.signal}),provider.tracks.resolve({},'128k',{id:'source',signal:b.signal})])
release();await new Promise(r=>setTimeout(r,10));a.abort();await new Promise(r=>setTimeout(r,10))
const aborted=requests.filter(r=>r.aborted).length
console.log('Concurrent direct HTTP requests cancelled:',aborted,'/',requests.length)
if(!observe)assert.equal(aborted,2,'Keep the existing conservative per-plugin cancellation when multiple calls are active')
for(const r of requests)r.reject(new Error('test cleanup'));await pending
fs.writeFileSync(out+'/runtime-http-cancel-'+(observe?'before':'after')+'.json',JSON.stringify({observe,aborted,count:requests.length,requests:requests.map(({id,aborted})=>({id,aborted})),scope:'Actual serialized runtime compatibility function; controlled Host HTTP promises and two real AbortControllers'},null,2))
if(!observe)console.log('PASS concurrent MusicFree-style direct broker requests retain operation-bound cancellation')
