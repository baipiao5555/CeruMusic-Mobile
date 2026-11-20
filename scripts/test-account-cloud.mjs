import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { randomUUID, createHash } from 'node:crypto'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = process.env.CERU_SYNC_SOURCE_ROOT || path.resolve(here, '..')
const out = process.env.CERU_QA_DIR || path.resolve(here, '../../../../verification/cloud')
const ts = createRequire(root+'/package.json')('typescript')
const checks = []
function environment(handler, directory, options = {}) {
  const storage = new Map(), requests = [], modules = new Map()
  let quota = false, version = 1, directoryRequests = 0, songRequests = 0
  const auth = { authState: { authenticated: true, user: { sub: 'fixture-A' } },
    getAuthSessionVersion: () => version, getAccessToken: async () => 'fixture-only',
    logout() { version++; auth.authState.authenticated = false; auth.authState.user = null },
    switchUser() { version++; auth.authState.authenticated = true; auth.authState.user = { sub: 'fixture-B' } }
  }
  const ctx = vm.createContext({ URL, URLSearchParams, console, TextEncoder,
    localStorage: { getItem: k => storage.get(k) ?? null, setItem(k,v) {
      if (quota) throw Error('fixture quota'); storage.set(k,v)
    }, removeItem: k => storage.delete(k) } })
  function load(file) {
    const full = path.resolve(root, file)
    if (modules.has(full)) return modules.get(full)
    const exports = {}; modules.set(full, exports)
    const code = ts.transpileModule(fs.readFileSync(full,'utf8'), {compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
    }}).outputText
    function req(id) {
      if (id === 'vue') return { reactive: x => x, watch() {} }
      if (id === './auth') return options.actualAuth ? load('src/core/auth.ts') : auth
      if (id === '@capacitor/core') return { Capacitor: { isNativePlatform: () => false } }
      if (id === './native/plugins') return { External: { open: async () => {} } }
      if (id === './net') return { errorMessage: (d,f) => d?.message || f,
        httpRequest: async options => {
          const url = new URL(options.url); requests.push(url)
          if (url.pathname.endsWith('/oidc/token')) return { status: 200, data: { access_token: 'synthetic-access-only', expires_in: 3600 } }
          if (url.pathname.endsWith('/user-songlist')) return directory
            ? directory(url, ++directoryRequests)
            : {status:200,data:[playlist]}
          return handler(url, ++songRequests)
        } }
      if (id.endsWith('/plugin/manager')) return { allProviders: () => [], notify() {}, registerHostHooks() {} }
      if (id.endsWith('/shims/crypto')) return { randomUUID }
      if (id.startsWith('.')) return load(path.relative(root,path.resolve(path.dirname(full),id+'.ts')))
      throw Error('Unexpected dependency '+id)
    }
    vm.runInContext('(function(exports,require){'+code+'\n})',ctx,{filename:full})(exports,req)
    return exports
  }
  const library = load('src/core/library.ts'), cloud = load('src/core/cloud.ts')
  const seed = () => {
    const tracks = [track('old-1'),track('old-2')]
    library.libraryState.playlists = [{ id:'local', name:'Local original', createdAt:1, cloudId:'cloud',
      cloudOwnerId:'fixture-A', tracks, ...(library.cloudTrackKey ? { cloudBaselineKeys:tracks.map(library.cloudTrackKey) } : {}) }]
    storage.set('ceru.library.v1',JSON.stringify(library.libraryState))
    return JSON.stringify(library.libraryState)
  }
  return {library,cloud,auth:options.actualAuth ? load('src/core/auth.ts') : auth,storage,requests,seed,quota:()=>{quota=true}}
}
const track = id => ({id,providerId:'fixture',pluginId:'',providerName:'Fixture',title:id,artist:'Test',album:'',durationMs:0,artwork:'',qualities:[],ref:{id,providerId:'fixture',kind:'track',scope:'provider'}})
const song = (id,pos) => ({songmid:String(id),source:'fixture',name:String(id),singer:'Test', ...(pos === undefined ? {} : {pos})})
const response = (list,total) => ({status:200,data:{code:200,data:{list,total}}})
const playlist = {id:'cloud',name:'Fixture',updatedAt:'2026-11-16T00:00:00Z'}
const deferred = () => {let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
async function check(name, fn) {
  try { const actual=await fn(); checks.push({name,result:'PASS',actual}); console.log('PASS '+name) }
  catch (e) { checks.push({name,result:'FAIL',error:e.stack||String(e)}); console.error('FAIL '+name+': '+e.message) }
}
for (const [name,count,start,step,cap] of [
  ['spaced position cursor imports exact500',500,2,2,200],
  ['negative positions start without cursor and import all',500,-1000,3,200],
  ['short capped pages continue until total450',450,1,1,100],
  ['more than50 pages imports10001 without truncation',10001,1,1,200]
]) await check(name, async()=>{
  const songs=Array.from({length:count},(_,i)=>song(i,start+i*step))
  const e=environment(url=>response(songs.filter(s=>!url.searchParams.has('pos')||s.pos>Number(url.searchParams.get('pos'))).slice(0,cap),count))
  const r=await e.cloud.importCloudPlaylist(playlist)
  assert.equal(r.total,count);assert.equal(new Set(r.playlist.tracks.map(t=>t.id)).size,count)
  assert.equal(e.requests.find(u=>u.pathname.endsWith('/list')).searchParams.has('pos'),false)
  return {tracks:r.total,requests:e.requests.length}
})
await check('legacy missing-pos offset pages and same-ID repeated import stay exact',async()=>{
  const songs=Array.from({length:450},(_,i)=>song(i))
  const e=environment(url=>response(songs.slice(Number(url.searchParams.get('pos')),Number(url.searchParams.get('pos'))+200),450))
  await e.cloud.importCloudPlaylist(playlist); const r=await e.cloud.importCloudPlaylist(playlist)
  assert.equal(r.total,450);assert.equal(e.library.libraryState.playlists.length,1)
  return {tracks:r.total,playlists:1}
})
for (const [name,handler] of [
  ['repeated pages reject without overwriting',()=>response(Array.from({length:200},(_,i)=>song(i)),450)],
  ['business code500 rejects without clearing',()=>({status:200,data:{code:500,data:null}})],
  ['invalid list structure rejects without clearing',()=>({status:200,data:{code:200,data:{total:2}}})],
  ['empty invalid total rejects without clearing',()=>response([],null)],
  ['missing page before declared total rejects',(_,i)=>response(i===1?Array.from({length:200},(_,j)=>song(j)):[],450)],
  ['changing remote total rejects',(_,i)=>response(Array.from({length:200},(_,j)=>song(i*200+j)),i===1?450:451)],
  ['invalid song rejects without clearing',()=>response([null],1)]
]) await check(name,async()=>{
  const e=environment(handler),before=e.seed()
  await assert.rejects(e.cloud.importCloudPlaylist(playlist))
  assert.equal(JSON.stringify(e.library.libraryState),before)
  assert.equal(e.storage.get('ceru.library.v1'),before)
  return {originalTracks:2,unchanged:true}
})
await check('legitimate empty remote removes unchanged baseline songs',async()=>{
  const e=environment(()=>response([],0));e.seed()
  const r=await e.cloud.importCloudPlaylist(playlist);assert.equal(r.total,0);assert.equal(r.playlist.tracks.length,0)
  return {tracks:0}
})
await check('quota failure rejects with both memory and disk unchanged',async()=>{
  const e=environment(()=>response([song('new')],1)),before=e.seed();e.quota()
  await assert.rejects(e.cloud.importCloudPlaylist(playlist))
  assert.equal(JSON.stringify(e.library.libraryState),before);assert.equal(e.storage.get('ceru.library.v1'),before)
  return {unchanged:true}
})
await check('same playlist concurrent imports share one fetch',async()=>{
  const d=deferred(),e=environment(()=>d.promise)
  const a=e.cloud.importCloudPlaylist(playlist),b=e.cloud.importCloudPlaylist(playlist)
  await new Promise(r=>setTimeout(r,0));d.resolve(response([song('1')],1));await Promise.all([a,b])
  assert.equal(e.requests.filter(u=>u.pathname.endsWith('/list')).length,1);assert.equal(e.library.libraryState.playlists.length,1)
  return {songRequests:1,playlists:1}
})
await check('logout cancels late cloud commit',async()=>{
  const d=deferred(),e=environment(()=>d.promise),p=e.cloud.importCloudPlaylist(playlist)
  await new Promise(r=>setTimeout(r,0));e.auth.logout();d.resolve(response([song('1')],1))
  await assert.rejects(p);assert.equal(e.library.libraryState.playlists.length,0)
  return {playlists:0}
})
await check('old401 does not log new account out',async()=>{
  const d=deferred(),e=environment(()=>d.promise,()=>d.promise),p=e.cloud.fetchCloudPlaylists()
  await new Promise(r=>setTimeout(r,0));e.auth.switchUser();d.resolve({status:401,data:{}})
  await assert.rejects(p);assert.equal(e.auth.authState.user.sub,'fixture-B');assert.equal(e.auth.authState.authenticated,true)
  return {user:'fixture-B'}
})
await check('older directory response never replaces newer list',async()=>{
  const d=deferred(),e=environment(()=>{},(_,i)=>i===1?d.promise:{status:200,data:[{id:'new',name:'New'}]})
  const old=e.cloud.fetchCloudPlaylists();await new Promise(r=>setTimeout(r,0))
  await e.cloud.fetchCloudPlaylists();d.resolve({status:200,data:[{id:'old',name:'Old'}]});await old
  assert.equal(e.cloud.cloudState.playlists[0].id,'new');return {id:'new'}
})
await check('batch refreshes directory and reports failed playlist',async()=>{
  const e=environment(url=>url.searchParams.get('id')==='bad'?{status:500,data:{message:'fixture offline'}}:response([song('1')],1),
    ()=>({status:200,data:[{...playlist,id:'good',name:'Good'},{...playlist,id:'bad',name:'Bad'}]}))
  e.cloud.cloudState.playlists=[{id:'stale',name:'Stale'}]
  const r=await e.cloud.importAllCloudPlaylists()
  assert.equal(r.playlists,1);assert.equal(r.failed.length,1);assert.equal(r.failed[0].id,'bad')
  return {playlists:1,failed:1}
})
await check('same public ID from different providers stays distinct',async()=>{
  const e=environment(()=>response([song('1'),{...song('1'),source:'other'}],2))
  const r=await e.cloud.importCloudPlaylist(playlist);assert.equal(r.total,2)
  return {tracks:2}
})
await check('same private ID on different connections stays distinct and private',async()=>{
  const list=['A','B'].map(connectionId=>({...song('1'),pluginResource:{pluginId:'private',providerId:'private',kind:'track',id:'1',connectionId}}))
  const e=environment(()=>response(list,2)),r=await e.cloud.importCloudPlaylist(playlist)
  assert.equal(r.total,2);assert.deepEqual(r.playlist.tracks.map(t=>t.ref.connectionId).join(','),'A,B')
  assert.ok(r.playlist.tracks.every(t=>t.ref.scope!=='provider'))
  return {tracks:2,private:true}
})
await check('plain legacy array deduplicates exact identities',async()=>{
  const e=environment((_,i)=>({status:200,data:i===1?[song('1'),song('1')]:[]})),r=await e.cloud.importCloudPlaylist(playlist)
  assert.equal(r.total,1);return {tracks:1}
})
await check('same-count cloud replacement during pagination rejects mixed snapshot',async()=>{
  const e=environment((_,i)=>response(Array.from({length:200},(_,j)=>song((i===1?'old-':'new-')+(i-1)*200+j,i*200+j)),400),
    (_,i)=>({status:200,data:[{...playlist,updatedAt:i===1?playlist.updatedAt:'2026-11-16T01:00:00Z'}]}))
  const before=e.seed();await assert.rejects(e.cloud.importCloudPlaylist(playlist))
  assert.equal(JSON.stringify(e.library.libraryState),before);return {unchanged:true}
})
for (const [count,positioned] of [[450,false],[250,true]]) await check(`bare array capped100 ${positioned?'position':'offset'} imports exact${count} through empty tail`,async()=>{
  const songs=Array.from({length:count},(_,i)=>song(i,positioned?i*3-100:undefined))
  const e=environment(url=>({status:200,data:positioned
    ? songs.filter(s=>!url.searchParams.has('pos')||s.pos>Number(url.searchParams.get('pos'))).slice(0,100)
    : songs.slice(Number(url.searchParams.get('pos')),Number(url.searchParams.get('pos'))+100)}))
  const r=await e.cloud.importCloudPlaylist(playlist)
  assert.equal(r.total,count);assert.equal(new Set(r.playlist.tracks.map(t=>t.id)).size,count)
  const pages=e.requests.filter(u=>u.pathname.endsWith('/list'))
  assert.equal(pages.length,Math.ceil(count/100)+1)
  return {tracks:r.total,pages:pages.length,explicitEmptyTail:true}
})
await check('bare empty tail clears only an unchanged confirmed-owner baseline',async()=>{
  const e=environment(()=>({status:200,data:[]}));e.seed()
  const r=await e.cloud.importCloudPlaylist(playlist)
  assert.equal(r.total,0);assert.equal(r.playlist.tracks.length,0);assert.equal(r.playlist.cloudOwnerId,'fixture-A')
  return {tracks:0,confirmedOwner:r.playlist.cloudOwnerId}
})
for (const [name,handler] of [
  ['bare repeated capped page rejects without overwriting',()=>({status:200,data:Array.from({length:100},(_,i)=>song(i))})],
  ['bare partially overlapping pages reject without overwriting',(_,page)=>({status:200,data:Array.from({length:100},(_,i)=>song((page-1)*99+i))})],
  ['bare nonadvancing position page rejects without overwriting',(_,page)=>({status:200,data:Array.from({length:100},(_,i)=>song(page*100+i,i))})],
  ['pagination response shape change rejects without overwriting',(_,page)=>page===1?{status:200,data:Array.from({length:100},(_,i)=>song(i))}:response(Array.from({length:100},(_,i)=>song(100+i)),200)],
  ['bare endless advancing pages stop at existing10000 page bound',(_,page)=>({status:200,data:[song(page)]})]
]) await check(name,async()=>{
  const e=environment(handler),before=e.seed()
  await assert.rejects(e.cloud.importCloudPlaylist(playlist,{replaceLocalChanges:true}))
  assert.equal(JSON.stringify(e.library.libraryState),before);assert.equal(e.storage.get('ceru.library.v1'),before)
  const pages=e.requests.filter(u=>u.pathname.endsWith('/list')).length
  assert.ok(pages<=10000)
  return {unchanged:true,pages}
})
await check('actual auth access-token-only callback stays signed in but cannot write cloud library',async()=>{
  const e=environment(()=>response([song('new')],1),undefined,{actualAuth:true}),before=e.seed()
  e.storage.set('ceru.auth.pending.v1',JSON.stringify({verifier:'synthetic-verifier',state:'synthetic-state',nonce:'synthetic-nonce',createdAt:Date.now()}))
  await e.auth.handleAuthCallback('cerumusic://oauth/callback?code=synthetic-code&state=synthetic-state')
  assert.equal(e.auth.authState.authenticated,true);assert.equal(e.auth.authState.user,null)
  await assert.rejects(e.cloud.importCloudPlaylist(playlist,{replaceLocalChanges:true}),/身份/)
  assert.equal(JSON.stringify(e.library.libraryState),before);assert.equal(e.storage.get('ceru.library.v1'),before)
  assert.equal(e.requests.filter(u=>u.pathname.includes('/user-songlist')).length,0)
  return {actualAuth:true,authenticated:true,user:null,cloudRequests:0,unchanged:true}
})
await check('owner disappearance during cloud read refuses a late write',async()=>{
  const e=environment(()=>{e.auth.authState.user=null;return response([song('new')],1)}),before=e.seed()
  await assert.rejects(e.cloud.importCloudPlaylist(playlist,{replaceLocalChanges:true}),/身份/)
  assert.equal(JSON.stringify(e.library.libraryState),before);assert.equal(e.storage.get('ceru.library.v1'),before)
  return {unchanged:true}
})
fs.mkdirSync(out,{recursive:true})
const hashes=Object.fromEntries(['src/core/cloud.ts','src/core/library.ts','src/core/auth.ts'].map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')]))
const failed=checks.filter(c=>c.result==='FAIL').length
fs.writeFileSync(path.join(out,'cloud-regression.json'),JSON.stringify({sourceRoot:root,sourceSha256:hashes,testScriptSha256:createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),isolation:'real TS modules with mocked HTTP/storage; actual auth access-token-only callback plus isolated session fixtures; no live cloud',checks,failed,exitCode:failed?1:0},null,2))
console.log(JSON.stringify({checks:checks.length,failed}));process.exitCode=failed?1:0
