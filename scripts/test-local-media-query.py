"""Compile the actual scanner against a strict MediaStore contract double, not a device."""
from pathlib import Path
import subprocess,sys,shutil,json
root=Path(__file__).resolve().parents[1]
source=Path(sys.argv[1]) if len(sys.argv)>1 else root
old='--old' in sys.argv
out=root.parent/'evidence'/('scan-before' if old else 'scan-after');out.mkdir(parents=True,exist_ok=True)
src=out/'src';classes=out/'classes';classes.mkdir(exist_ok=True)
stubs={
'android/Manifest.java':'public class Manifest {public static class permission {public static final String READ_MEDIA_AUDIO="audio",READ_EXTERNAL_STORAGE="storage";}}',
'android/net/Uri.java':'public class Uri {String value;public Uri(String s){value=s;} public static Uri fromFile(java.io.File f){return new Uri(f.toURI().toString());} public String toString(){return value;}}',
'android/content/ContentUris.java':'public class ContentUris {public static android.net.Uri withAppendedId(android.net.Uri u,long id){return new android.net.Uri(u+"/"+id);}}',
'android/content/Context.java':'public class Context {public static java.io.File root;public static ContentResolver resolver=new ContentResolver();public java.io.File getExternalFilesDir(String s){return new java.io.File(root,"external");} public java.io.File getFilesDir(){return new java.io.File(root,"internal");} public ContentResolver getContentResolver(){return resolver;}}',
'android/content/ContentResolver.java':'public class ContentResolver {public int calls;public String order;public String selection;public int failure;public android.database.Cursor last;public android.database.Cursor query(android.net.Uri u,String[] c,String s,String[] a,String o){calls++;order=o;selection=s;if(o.contains("LOCALIZED"))throw new IllegalArgumentException("Invalid token LOCALIZED");if(failure==1)throw new SecurityException("revoked");if(failure==2)throw new IllegalStateException("provider offline");return last=new android.database.Cursor(c);}}',
'android/database/Cursor.java':'public class Cursor {String[] c;boolean read;public boolean closed;Object[] row={42L,"系统歌曲","系统歌手","系统专辑",5000L,2048L,"audio/mpeg"};public Cursor(String[] c){this.c=c;} public int getColumnIndex(String s){for(int i=0;i<c.length&&i<row.length;i++)if(c[i].equals(s))return i;return -1;} public int getColumnIndexOrThrow(String s){for(int i=0;i<c.length;i++)if(c[i].equals(s))return i;throw new IllegalArgumentException(s);} public boolean moveToNext(){if(read)return false;read=true;return true;} public String getString(int i){return String.valueOf(row[i]);} public long getLong(int i){return ((Number)row[i]).longValue();} public void close(){closed=true;}}',
'android/os/Build.java':'public class Build {public static class VERSION {public static int SDK_INT=34;}}',
'android/os/Environment.java':'public class Environment {public static final String DIRECTORY_MUSIC="Music";}',
'android/provider/MediaStore.java':'public class MediaStore {public static class Audio {public static class Media {public static final android.net.Uri EXTERNAL_CONTENT_URI=new android.net.Uri("content://media/external/audio/media");public static final String _ID="id",TITLE="title",ARTIST="artist",ALBUM="album",DURATION="duration",SIZE="size",MIME_TYPE="mime";}}}',
'android/text/TextUtils.java':'public class TextUtils {public static boolean isEmpty(String s){return s==null||s.isEmpty();}}',
'android/webkit/MimeTypeMap.java':'public class MimeTypeMap {public static MimeTypeMap getSingleton(){return new MimeTypeMap();}public String getMimeTypeFromExtension(String s){return "audio/wav";}}',
'android/media/MediaMetadataRetriever.java':'public class MediaMetadataRetriever {public static final int METADATA_KEY_TITLE=1,METADATA_KEY_ARTIST=2,METADATA_KEY_ALBUM=3,METADATA_KEY_DURATION=4;public void setDataSource(String p){}public String extractMetadata(int k){return null;}public void release(){}}',
'com/getcapacitor/JSArray.java':'public class JSArray extends java.util.ArrayList<Object>{public void put(Object o){add(o);}}',
'com/getcapacitor/JSObject.java':'public class JSObject extends java.util.HashMap<String,Object>{}',
'com/getcapacitor/PermissionState.java':'public enum PermissionState {GRANTED,DENIED}',
'com/getcapacitor/PluginCall.java':'public class PluginCall {public volatile JSObject result;public String getString(String s){return "all";}public void resolve(JSObject r){result=r;}}',
'com/getcapacitor/Plugin.java':'public class Plugin {public static PermissionState permission=PermissionState.GRANTED;public android.content.Context getContext(){return new android.content.Context();}public PermissionState getPermissionState(String s){return permission;}public void requestPermissionForAlias(String s,PluginCall c,String p){}}',
'com/getcapacitor/PluginMethod.java':'public @interface PluginMethod {}',
'com/getcapacitor/annotation/CapacitorPlugin.java':'public @interface CapacitorPlugin {String name();Permission[] permissions();}',
'com/getcapacitor/annotation/Permission.java':'public @interface Permission {String alias();String[] strings();}',
'com/getcapacitor/annotation/PermissionCallback.java':'public @interface PermissionCallback {}',
}
stubs['android/provider/DocumentsContract.java']='public class DocumentsContract {public static String getTreeDocumentId(android.net.Uri u){return "";}}'
stubs['com/ceru/music/mobile/MusicFoldersPlugin.java']='public class MusicFoldersPlugin {static void appendManaged(android.content.Context c,com.getcapacitor.JSArray a){}static java.util.List<android.net.Uri> scanFolders(android.content.Context c){return java.util.Collections.emptyList();}static boolean hasGrant(android.content.Context c,android.net.Uri u,boolean w){return true;}static String folderLabel(android.content.Context c,android.net.Uri u){return "test";}static void appendFolder(android.content.Context c,android.net.Uri u,com.getcapacitor.JSArray a,java.util.Set<String>s,int[]v,int d,String id){}}'
for name,body in stubs.items():
 p=src/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('package '+str(Path(name).parent).replace('\\','.').replace('/','.')+';\n'+body,encoding='utf-8')
for name in ['LocalMediaPlugin.java','LocalAudioFiles.java']:
 p=src/'com/ceru/music/mobile'/name;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/'android/app/src/main/java/com/ceru/music/mobile'/name,p)
harness=r'''package com.ceru.music.mobile;
import com.getcapacitor.*;
public class Harness {
 static void check(boolean b,String s){if(!b)throw new AssertionError(s);System.out.println("PASS "+s);}
 public static void main(String[] args)throws Exception {
  android.content.Context.root=new java.io.File(args[0]);
  java.io.File music=new java.io.File(android.content.Context.root,"external");music.mkdirs();
  java.nio.file.Files.write(new java.io.File(music,"已下载.wav").toPath(),new byte[]{1,2,3});
  java.nio.file.Files.write(new java.io.File(music,"不是音频.txt").toPath(),new byte[]{1});
  LocalMediaPlugin plugin=new LocalMediaPlugin();PluginCall call=new PluginCall();plugin.scan(call); for(int wait=0;call.result==null&&wait<500;wait++)Thread.sleep(10);
  JSArray tracks=(JSArray)call.result.get("tracks");
  if(Boolean.parseBoolean(args[1])) {
   check(String.valueOf(call.result.get("error")).contains("Invalid token LOCALIZED"),"original strict query reproduces reported LOCALIZED error");
   check(tracks.size()==1,"original query failure keeps owned download but cannot enumerate MediaStore");return;
  }
  check(!call.result.containsKey("error")&&tracks.size()==2,"safe sort actually enumerates system audio plus owned download");
  check(android.content.Context.resolver.order.equals("title ASC")&&android.content.Context.resolver.selection.equals("size>0"),"strict provider receives valid sort and positive-size selection");
  check(android.content.Context.resolver.last.closed,"successful enumeration closes cursor");
  Plugin.permission=PermissionState.DENIED;call=new PluginCall();plugin.scan(call); for(int wait=0;call.result==null&&wait<500;wait++)Thread.sleep(10);
  check(((JSArray)call.result.get("tracks")).size()==1&&android.content.Context.resolver.calls==1,"permission denied still scans actual app download without querying MediaStore");
  Plugin.permission=PermissionState.GRANTED;android.content.Context.resolver.failure=1;call=new PluginCall();plugin.scan(call); for(int wait=0;call.result==null&&wait<500;wait++)Thread.sleep(10);
  check(Boolean.FALSE.equals(call.result.get("granted"))&&((JSArray)call.result.get("tracks")).size()==1&&call.result.containsKey("error"),"revoked permission preserves download and reports failure");
  android.content.Context.resolver.failure=2;call=new PluginCall();plugin.scan(call); for(int wait=0;call.result==null&&wait<500;wait++)Thread.sleep(10);
  check(String.valueOf(call.result.get("error")).contains("provider offline"),"unrelated MediaStore failure is not suppressed");
 }
}'''
p=src/'com/ceru/music/mobile/Harness.java';p.write_text(harness,encoding='utf-8')
java=Path(r'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot\bin')
commands=[[str(java/'javac.exe'),'-encoding','UTF-8','-d',str(classes),*[str(p) for p in src.rglob('*.java')]],[str(java/'java.exe'),'-cp',str(classes),'com.ceru.music.mobile.Harness',str(out/'downloads'),str(old).lower()]]
records=[]
for command in commands:
 run=subprocess.run(command,capture_output=True,text=True,encoding='utf-8',errors='replace');print(run.stdout,run.stderr);records.append({'command':command,'stdout':run.stdout,'stderr':run.stderr,'exitCode':run.returncode})
 if run.returncode:break
(out/'commands.json').write_text(json.dumps({'scope':'Actual Java scanner with strict provider/permission test doubles; not Android device verification','runs':records},ensure_ascii=False,indent=2),encoding='utf-8')
sys.exit(records[-1]['exitCode'])
