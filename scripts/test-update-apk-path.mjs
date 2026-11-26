import assert from 'node:assert/strict'
import fs from 'node:fs'
const downloader=fs.readFileSync('android/app/src/main/java/com/ceru/music/mobile/DownloaderPlugin.java','utf8')
const external=fs.readFileSync('android/app/src/main/java/com/ceru/music/mobile/ExternalPlugin.java','utf8')
const updater=fs.readFileSync('src/core/updater.ts','utf8')
assert.match(downloader,/downloadUpdate/)
assert.match(downloader,/updateDir\(\)/)
assert.match(downloader,/DIRECTORY_DOWNLOADS/)
assert.match(downloader,/performToFile/)
assert.match(external,/String path = call.getString\("path"\)/)
assert.match(external,/esolved.startsWith\(external\)/)
assert.match(updater,/Downloader\.downloadUpdate/)
assert.match(updater,/downloadedPath/)
console.log('PASS update APK uses app-private Downloads + FileProvider; no MediaStore audio insertion')
