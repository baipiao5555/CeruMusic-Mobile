import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
const out = process.env.CERU_QA_OUT || path.join(os.tmpdir(), 'ceru-sync-native-qa')
const source = process.env.CERU_NATIVE_QA_SOURCE || path.join(import.meta.dirname, 'fixtures/NativeSyncQa.java')
await fs.mkdir(out, { recursive: true })
const cache = path.join(os.homedir(), '.gradle/caches/modules-2/files-2.1')
async function jars(group, artifact, version) { const root = path.join(cache, group, artifact, version), files = []; for (const hash of await fs.readdir(root)) for (const file of await fs.readdir(path.join(root, hash))) if (file.endsWith('.jar')) files.push(path.join(root, hash, file)); return files }
const kotlinDir = path.join(cache, 'org.jetbrains.kotlin/kotlin-stdlib'), kotlinVersion = (await fs.readdir(kotlinDir)).sort().at(-1)
const classpath = [...await jars('com.squareup.okhttp3', 'okhttp', '4.9.2'), ...await jars('com.squareup.okio', 'okio', '2.9.0'), ...await jars('org.jetbrains.kotlin', 'kotlin-stdlib', kotlinVersion)].join(path.delimiter)
const javaHome = process.env.JAVA_HOME || 'C:/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot'
const commands = []
for (const [binary, args] of [['javac.exe', ['-cp', classpath, '-d', out, source]], ['java.exe', ['-cp', out + path.delimiter + classpath, 'NativeSyncQa', out]]]) {
  const command = path.join(javaHome, 'bin', binary), result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
  commands.push({ command, args, exitCode: result.status, stdout: result.stdout, stderr: result.stderr }); process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '')
  if (result.status !== 0) { await fs.writeFile(path.join(out, 'native-primitives-tests.json'), JSON.stringify({ scope: 'Actual JCA AESGCM and OkHttp/JVM TLS, not AndroidKeyStore device test', commands }, null, 2)); process.exit(result.status || 1) }
}
await fs.writeFile(path.join(out, 'native-primitives-tests.json'), JSON.stringify({ scope: 'Actual JCA AESGCM and OkHttp/JVM TLS, not AndroidKeyStore device test; generated test certificate is anonymous and not an app signing key', commands }, null, 2))
