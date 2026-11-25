import assert from 'node:assert/strict'
import fs from 'node:fs'

const activity = fs.readFileSync('android/app/src/main/java/com/ceru/music/mobile/MainActivity.java', 'utf8')
const capacitorClient = fs.readFileSync('node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/BridgeWebViewClient.java', 'utf8')

assert.match(activity, /addWebViewListener\(new WebViewListener\(\)/)
assert.match(activity, /boolean onRenderProcessGone\([\s\S]*?recoverWebView\(view\);[\s\S]*?return true;/)
assert.match(activity, /recoveringWebView \|\| isFinishing\(\) \|\| isDestroyed\(\)/)
const recovery = activity.slice(activity.indexOf('private void recoverWebView'))
assert(recovery.indexOf('removeView(view)') < recovery.indexOf('view.destroy()'))
assert(recovery.indexOf('view.destroy()') < recovery.indexOf('recreate()'))
assert.match(capacitorClient, /listener\.onRenderProcessGone\(view, detail\)/)
assert.match(activity, /public void onResume\(\)[\s\S]*?scheduleWebViewHealthCheck\(\)/)
assert.match(activity, /checkWebViewHealth\(WebView view\)[\s\S]*?evaluateJavascript/)
assert.match(activity, /WebView resume health check timed out; rebuilding the activity/)

console.log('PASS native recovery contract: renderer-exit callback handled; dead WebView removed, destroyed and activity recreated')
console.log('PASS resume watchdog contract: force repaint, DOM health probe, timed-out renderer recovery')
console.log('Scope: source/compile contract only; physical lock-screen recovery still requires an Android device test')
