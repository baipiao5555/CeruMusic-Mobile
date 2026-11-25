"""Execute MainActivity watchdog lifecycle against Android/Capacitor doubles, not a phone."""
from pathlib import Path
import subprocess, json, shutil
root = Path(__file__).resolve().parents[1]
out = root.parent / 'evidence' / 'webview-lifecycle'
src, classes = out/'src', out/'classes'
classes.mkdir(parents=True, exist_ok=True)
stubs = {
'android/Manifest.java':'public class Manifest {public static class permission {public static String POST_NOTIFICATIONS="notification";}}',
'android/content/Intent.java':'public class Intent {}',
'android/content/pm/PackageManager.java':'public class PackageManager {public static int PERMISSION_GRANTED=0;}',
'android/os/Build.java':'public class Build {public static class VERSION {public static int SDK_INT=34;}public static class VERSION_CODES {public static int UPSIDE_DOWN_CAKE=34,TIRAMISU=33;}}',
'android/os/Bundle.java':'public class Bundle {}',
'android/os/Looper.java':'public class Looper {public static Looper getMainLooper(){return new Looper();}}',
'android/os/SystemClock.java':'public class SystemClock {public static long elapsedRealtime(){return 1000000;}}',
'android/os/Handler.java':'''public class Handler {public static java.util.List<Runnable> tasks=new java.util.ArrayList<>();public Handler(Looper l){}public void postDelayed(Runnable r,long ms){tasks.add(r);}public void removeCallbacks(Runnable r){tasks.remove(r);}}''',
'android/util/Log.java':'public class Log {public static int w(String t,String m){System.out.println(m);return 0;}}',
'android/view/ViewGroup.java':'public class ViewGroup {public void removeView(Object v){}}',
'android/webkit/WebSettings.java':'public class WebSettings {public static int MIXED_CONTENT_ALWAYS_ALLOW=0;public void setMixedContentMode(int v){}}',
'android/webkit/RenderProcessGoneDetail.java':'public class RenderProcessGoneDetail {}',
'android/webkit/WebView.java':'''public class WebView {public boolean attached=true;public int reloads,destroys,repaints;public String answer="true";public java.util.function.Consumer<String> pending;
 public void requestLayout(){}public void invalidate(){repaints++;}public boolean isAttachedToWindow(){return attached;}public WebSettings getSettings(){return new WebSettings();}
 public Object getParent(){return null;}public void destroy(){destroys++;attached=false;}public void reload(){reloads++;}
 public void evaluateJavascript(String js,java.util.function.Consumer<String> cb){if(answer==null)pending=cb;else cb.accept(answer);}}''',
'androidx/core/app/ActivityCompat.java':'public class ActivityCompat {public static void requestPermissions(Object a,String[] p,int id){}}',
'androidx/core/content/ContextCompat.java':'public class ContextCompat {public static int checkSelfPermission(Object c,String p){return 0;}}',
'com/getcapacitor/WebViewListener.java':'public class WebViewListener {public boolean onRenderProcessGone(android.webkit.WebView v,android.webkit.RenderProcessGoneDetail d){return false;}}',
'com/getcapacitor/Bridge.java':'public class Bridge {public android.webkit.WebView view=new android.webkit.WebView();public android.webkit.WebView getWebView(){return view;}public void addWebViewListener(WebViewListener v){}}',
'com/getcapacitor/BridgeActivity.java':'''public class BridgeActivity {public int recreates;public android.content.Intent intent;public static int OVERRIDE_TRANSITION_CLOSE=0;public Bridge bridge=new Bridge();public Bridge getBridge(){return bridge;}
 public void onCreate(android.os.Bundle b){}public void onResume(){}public void onPause(){}public void onDestroy(){}public void finish(){}
 public boolean isFinishing(){return false;}public boolean isDestroyed(){return false;}public void recreate(){recreates++;}
 public void registerPlugin(Class<?> c){}public void overrideActivityTransition(int a,int b,int c){}public void overridePendingTransition(int a,int b){}
 public void setIntent(android.content.Intent i){intent=i;}protected void onNewIntent(android.content.Intent i){}}''',
'com/ceru/music/mobile/R.java':'public class R {public static class anim {public static int app_exit=1;}}'
}
for name in ['BackgroundAudioPlugin','SecureHttpPlugin','SystemBarsPlugin','DownloaderPlugin','ExternalPlugin','AudioCachePlugin','LocalMediaPlugin','MusicFoldersPlugin','SecretStorePlugin','SyncHttpPlugin','SyncKeepAlivePlugin']:
    stubs['com/ceru/music/mobile/'+name+'.java']='public class '+name+' {}'
for name,code in stubs.items():
    p=src/name;p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text('package '+str(Path(name).parent).replace('\\','.').replace('/','.')+';\n'+code,encoding='utf-8')
shutil.copy2(root/'android/app/src/main/java/com/ceru/music/mobile/MainActivity.java',src/'com/ceru/music/mobile/MainActivity.java')
harness='''package com.ceru.music.mobile;
public class Harness{
 static void ok(boolean b,String s){if(!b)throw new AssertionError(s);System.out.println("PASS "+s);}
 static MainActivity start(){android.os.Handler.tasks.clear();MainActivity a=new MainActivity();a.onResume();return a;}
 public static void main(String[] args)throws Exception{
 MainActivity a=start();android.webkit.WebView v=a.bridge.view;ok(v.repaints==1,"resume asks WebView to repaint");
 android.os.Handler.tasks.remove(0).run();ok(v.reloads==0,"healthy page is not reloaded");android.os.Handler.tasks.remove(0).run();ok(a.recreates==0,"healthy callback prevents watchdog recovery");
 a=start();v=a.bridge.view;v.answer=null;android.os.Handler.tasks.remove(0).run();a.onPause();android.os.Handler.tasks.remove(0).run();ok(a.recreates==0,"background transition cancels a pending timeout by generation");
 a=start();v=a.bridge.view;v.answer="false";android.os.Handler.tasks.remove(0).run();ok(v.reloads==1,"empty UI reloads once");
 a=start();v=a.bridge.view;v.answer=null;android.os.Handler.tasks.remove(0).run();android.os.Handler.tasks.remove(0).run();ok(a.recreates==1&&v.destroys==1,"unresponsive foreground renderer is destroyed and Activity rebuilt");
 a=start();v=a.bridge.view;v.answer=null;android.os.Handler.tasks.remove(0).run();a.onPause();a.onResume();v.pending.accept("false");ok(v.reloads==0,"late callback from old resume cannot reload the new foreground page");
 android.content.Intent i=new android.content.Intent();a.onNewIntent(i);ok(a.intent==i,"callback Intent survives Activity recreation");
 }}'''
(src/'com/ceru/music/mobile/Harness.java').write_text(harness,encoding='utf-8')
jdk=Path(r'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot\bin')
commands=[[str(jdk/'javac.exe'),'-encoding','UTF-8','-d',str(classes),*[str(p) for p in src.rglob('*.java')]],
          [str(jdk/'java.exe'),'-cp',str(classes),'com.ceru.music.mobile.Harness']]
records=[]
for command in commands:
    run=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',errors='replace')
    print(run.stdout,run.stderr);records.append({'command':command,'exitCode':run.returncode,'stdout':run.stdout,'stderr':run.stderr})
    if run.returncode:break
(out/'runs.json').write_text(json.dumps({'scope':'Actual MainActivity lifecycle control flow with deterministic Android bridge doubles; no real renderer/phone measurement','runs':records},indent=2),encoding='utf-8')
raise SystemExit(records[-1]['exitCode'])
