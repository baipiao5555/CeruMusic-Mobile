import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {build} from 'esbuild'
const out=path.resolve(import.meta.dirname,'../../evidence'),audio=Buffer.from('RIFF'+String.fromCharCode(0,255,128,1)+'WAVE')
globalThis.__nativeMF={requests:[],audio:audio.toString('base64')}
const fixture={
 '@capacitor/core':`export const Capacitor={isNativePlatform:()=>true,convertFileSrc:p=>p};export const CapacitorHttp={request:async input=>{globalThis.__nativeMF.requests.push(input);return {status:200,data:globalThis.__nativeMF.audio,headers:{'content-type':'audio/wav'}}}}`,
 'manager':`export const allProviders=()=>[{pluginId:'qa',providerId:'qa',qualities:['128k']}];export const invokeProvider=async()=>({ok:true,url:'https://mf.audio.test/audio',requestHeaders:{Referer:'https://mf.audio.test/','User-Agent':'MusicFree QA','X-QA-Audio':'required'}})`,
 'cache':`export const localAudioUrl=async()=>''`,
 'webdav':`export const isWebDavTrack=()=>false;export const resolveWebDavTrackSource=()=>{throw new Error('unexpected webdav')}`
}
const result=await build({entryPoints:['src/core/playback/source.ts'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'native-http-response-double',setup(b){
 b.onResolve({filter:/.*/},({path:p})=>{const key=p==='@capacitor/core'?p:p.endsWith('plugin/manager')?'manager':p.endsWith('cache/audioCache')?'cache':p.endsWith('sync/webdavMedia')?'webdav':undefined;return key?{path:key,namespace:'qa'}:undefined})
 b.onLoad({filter:/.*/,namespace:'qa'},({path:p})=>({contents:fixture[p]}))
}}]})
const {playableSource}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))
const source=await playableSource({id:'qa',pluginId:'qa',providerId:'qa',ref:{id:'qa',kind:'track',providerId:'qa'},qualities:['128k']},'128k')
const response=await fetch(source.url),mime=response.headers.get('content-type')
const bytes=Buffer.from(await response.arrayBuffer());URL.revokeObjectURL(source.url)
console.log('Native audio Blob MIME:',mime)
if(!process.argv.includes('--observe'))assert.equal(mime,'audio/wav','Preserve the returned audio type instead of forcing every format to MP3')
assert.deepEqual(bytes,audio)
const request=globalThis.__nativeMF.requests[0];assert.equal(request.headers.Referer,'https://mf.audio.test/');assert.equal(request.headers['User-Agent'],'MusicFree QA');assert.equal(request.headers['X-QA-Audio'],'required');assert.equal(request.responseType,'arraybuffer')
if(!process.argv.includes('--observe')){
 for(const data of [audio.buffer.slice(audio.byteOffset,audio.byteOffset+audio.byteLength),Uint8Array.from(audio)]){
  globalThis.__nativeMF.audio=data
  const next=await playableSource({id:'qa',pluginId:'qa',providerId:'qa',ref:{id:'qa',kind:'track',providerId:'qa'},qualities:['128k']},'128k')
  assert.deepEqual(Buffer.from(await (await fetch(next.url)).arrayBuffer()),audio);URL.revokeObjectURL(next.url)
 }
 globalThis.__nativeMF.audio={error:'not audio'}
 await assert.rejects(playableSource({id:'qa',pluginId:'qa',providerId:'qa',ref:{id:'qa',kind:'track',providerId:'qa'},qualities:['128k']},'128k'),/不是有效的二进制/)
}
fs.writeFileSync(out+(process.argv.includes('--observe')?'/musicfree-native-audio-before.json':'/musicfree-native-audio.json'),JSON.stringify({passed:true,scope:'Actual source.ts native branch with a CapacitorHttp response double; not device execution',request,mime,bytes:bytes.length},null,2))
console.log('PASS actual native header-fetch branch passes Referer/User-Agent/custom headers and reconstructs exact binary audio bytes from base64')
delete globalThis.__nativeMF
