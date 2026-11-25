import assert from 'node:assert/strict'
import { build } from 'esbuild'
const result=await build({entryPoints:['src/core/quality.ts'],bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'providers',setup(b){b.onResolve({filter:/^\.\/plugin\/manager$/},()=>({path:'providers',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},()=>({contents:'export const allProviders=()=>[]'}))}}]})
const q=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))
const order=['96k','192k'],candidates=q.playbackQualityCandidates(order,order)
console.log('Automatic MusicFree candidates:',JSON.stringify(candidates))
if(!process.argv.includes('--observe')){
 assert.deepEqual(candidates,['192k','96k'])
 assert.equal(q.highestQuality(order),'192k')
 assert.deepEqual(q.playbackQualityCandidates(['64k','128k'],['64k','128k']),['128k','64k'])
 assert.deepEqual(q.playbackQualityCandidates(order,order,'96k'),['96k'])
 console.log('PASS MusicFree low bitrates: highest available first, descending fallback, manual selection unchanged')
}
