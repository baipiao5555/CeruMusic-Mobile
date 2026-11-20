import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../public/compat.js',import.meta.url),'utf8');let calls=0;
const context=vm.createContext({crypto:{getRandomValues:array=>{calls++;return webcrypto.getRandomValues(array)}},navigator:{userAgent:'Chromium/87'},console});
vm.runInContext("delete Array.prototype.at;delete Object.hasOwn;Math.random=function(){throw new Error('insecure RNG must not be used')}",context);vm.runInContext(source,context);
const values=vm.runInContext(`Array.from({length:100},()=>crypto.randomUUID())`,context);assert.equal(new Set(values).size,100);assert.equal(calls,100);assert(values.every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)));
assert.equal(vm.runInContext('[1,2,3].at(-1)',context),3);assert.equal(vm.runInContext("Object.hasOwn({x:1},'x')",context),true);assert.equal(vm.runInContext('Array.prototype.at.call({length:4294967297,4294967296:7},-1)',context),7);
const withoutCrypto=vm.createContext({console});vm.runInContext(source,withoutCrypto);assert.equal(vm.runInContext('typeof crypto',withoutCrypto),'undefined');
console.log('PASS legacy shared bootstrap: secure unique v4 UUIDs, Array.at and Object.hasOwn; no Math.random fallback or invented crypto');
