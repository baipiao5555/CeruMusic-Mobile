import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),require=createRequire(path.join(root,'package.json')),ts=require('typescript')
const seed=JSON.parse(fs.readFileSync(path.join(root,'../evidence/ceru-list.json'),'utf8'))
let reply=seed,quota=false,stored=null
globalThis.localStorage={getItem:()=>null,setItem:(_k,v)=>{if(quota)throw new Error('QA quota');stored=v}}
function load(file,mocks){const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exports={};new Function('require','exports',code)(name=>{if(!(name in mocks))throw new Error('unmocked '+name);return mocks[name]},exports);return exports}
const catalog=load('src/core/plugin/catalog.ts',{vue:{reactive:v=>v},'./distribution':{distributionState:{line:'github'},selectCatalogLine:()=>{},repositoryUrl:(p,line)=>'https://raw.githubusercontent.com/hebijunge/musicfree-plugins/master/'+p,requestRepository:async()=>({status:200,body:reply})},'./catalogSeed':{initialCatalog:seed}})
assert.equal(catalog.parseCatalog(seed).length,51)
assert.throws(()=>catalog.parseCatalog({plugins:[{...seed.plugins[0],file:'../secret.ceru.js'}]}),/有效/)
assert.throws(()=>catalog.parseCatalog({plugins:[seed.plugins[0],seed.plugins[0]]}),/有效/)
await catalog.refreshCatalog(true)
const valid=catalog.catalogState.items,clock=catalog.catalogState.cachedAt,cache=stored
reply={plugins:[{...seed.plugins[0],file:'https://localhost/a.ceru.js'}]};await catalog.refreshCatalog(true)
assert.equal(catalog.catalogState.items,valid);assert.equal(catalog.catalogState.cachedAt,clock);assert.equal(stored,cache)
quota=true;reply=seed;await catalog.refreshCatalog(true)
assert.equal(catalog.catalogState.items,valid);assert.match(catalog.catalogState.error,/quota/)
console.log('PASS actual catalog adapter: real count, protocol split, path/duplicate validation, bad response and storage failure preserve valid cache')
const snapshots=load('src/core/plugin/catalogManifests.ts',{}).knownCatalogManifests
const compat=load('src/core/plugin/compat.ts',{'../storage/idb':{sha256Hex:async s=>crypto.createHash('sha256').update(s).digest('hex')},'./catalogManifests':{knownCatalogManifests:snapshots}})
const raw=fs.readFileSync(path.join(root,'../evidence/catalog-raw/qq.ceru.js'),'utf8')
const wrapped=await compat.normalizeKnownPluginCode(raw)
assert.match(wrapped,/^exports\.manifest = /)
const unknown=raw+'\n// changed-code-not-approved'
assert.equal(await compat.normalizeKnownPluginCode(unknown),unknown)
assert.match(wrapped,/exports\.activate = function\(core\)/)
console.log('PASS checksum-pinned computed-manifest compatibility; changed unknown code is not interpreted or granted invented metadata')
const manager=fs.readFileSync(path.join(root,'src/core/plugin/manager.ts'),'utf8')
const start=manager.indexOf('export function comparePluginVersions('),end=manager.indexOf('\n/** Re-downloads',start)
const compare=loadFunction(manager.slice(start,end),'comparePluginVersions')
function loadFunction(text,name){const code=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const e={};new Function('exports',code)(e);return e[name]}
assert.equal(Math.sign(compare('2.0.0','2.0.0-beta.2')),1)
assert.equal(Math.sign(compare('2.0.0-beta.10','2.0.0-beta.2')),1)
assert.equal(compare('1.0.0+build','1.0.0'),0)
assert.throws(()=>compare('not-a-version','1.0.0'),/版本/)
console.log('PASS version comparison: release versus prerelease, numeric prerelease order, build metadata and invalid version rejection')
