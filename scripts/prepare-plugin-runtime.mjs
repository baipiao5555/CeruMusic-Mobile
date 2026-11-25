import fs from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const source = path.join(root, 'node_modules', '@shiqianjiang', 'ceru-plugin-core', 'assets')
const destination = path.join(root, 'public', 'plugin-runtime')
const files = ['sandbox.js', 'node-globals.js', 'catalog.json']

if (!fs.existsSync(source)) {
  console.error('未找到 @shiqianjiang/ceru-plugin-core，请先运行 npm install')
  process.exit(1)
}

fs.mkdirSync(destination, { recursive: true })
for (const file of files) {
  fs.copyFileSync(path.join(source, file), path.join(destination, file))
  console.log('plugin runtime:', file)
}
const compatibilityRoot = process.env.CERU_MF_DEPENDENCY_ROOT || root
const names=['axios','crypto-js','cheerio','he','big-integer','qs']
const libraries=await build({
  stdin:{contents:'import axios from "axios";import crypto from "crypto-js";import {load} from "cheerio/slim";import he from "he";import integer from "big-integer";import qs from "qs";globalThis.__musicFreeModules={axios,"crypto-js":crypto,cheerio:{load},he,"big-integer":integer,qs};',
    resolveDir:compatibilityRoot,loader:'js'},
  bundle:true,platform:'browser',format:'iife',minify:true,legalComments:'eof',target:'chrome87',write:false
})
fs.writeFileSync(path.join(destination,'musicfree-libraries.js'),libraries.outputFiles[0].text)
const licenses=names.map(name=>{
 const directory=path.join(compatibilityRoot,'node_modules',name)
 const file=fs.readdirSync(directory).find(file=>/^licen[sc]e(?:\.|$)/i.test(file))
 return name+'\n'+(file?fs.readFileSync(path.join(directory,file),'utf8'):'See package metadata')+'\n'
}).join('\n')
fs.writeFileSync(path.join(destination,'musicfree-licenses.txt'),licenses)
console.log('plugin runtime: MusicFree dependency bundle')
