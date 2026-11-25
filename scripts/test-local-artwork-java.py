"""Actual LocalArtwork.java control flow; platform media decoding substituted by ImageIO."""
from pathlib import Path
import subprocess, json, shutil, uuid

root = Path(__file__).resolve().parents[1]
out = root.parent / 'evidence' / 'artwork-java'
src, classes = out / 'src', out / 'classes'
classes.mkdir(parents=True, exist_ok=True)
stubs = {
'android/net/Uri.java': '''
public class Uri {
 final String v; public Uri(String v){this.v=v;} public static Uri parse(String v){return new Uri(v);}
 public static Uri fromFile(java.io.File f){return parse(f.toURI().toString());}
 public String getScheme(){return java.net.URI.create(v).getScheme();}
 public String getAuthority(){return java.net.URI.create(v).getAuthority();}
 public String toString(){return v;} public boolean equals(Object o){return o instanceof Uri&&v.equals(((Uri)o).v);}
}''',
'android/content/Context.java': '''
public class Context {public java.io.File root;public Context(java.io.File r){root=r;}public java.io.File getCacheDir(){return new java.io.File(root,"cache");}}''',
'android/provider/DocumentsContract.java': '''
public class DocumentsContract {public static String getTreeDocumentId(android.net.Uri u){String v=u.toString();int x=v.indexOf("/tree/");if(x<0)throw new IllegalArgumentException();return v.substring(x+6).split("/")[0];}}''',
'android/media/MediaMetadataRetriever.java': '''
public class MediaMetadataRetriever {
 public static byte[] picture;public static int calls;public void setDataSource(android.content.Context c,android.net.Uri u){}
 public byte[] getEmbeddedPicture(){calls++;return picture;}public void release(){}
}''',
'android/graphics/Bitmap.java': '''
public class Bitmap {java.awt.image.BufferedImage image;public Bitmap(java.awt.image.BufferedImage i){image=i;}public static class CompressFormat {public static final CompressFormat JPEG=new CompressFormat();}
 public boolean compress(CompressFormat f,int q,java.io.OutputStream o){try{return javax.imageio.ImageIO.write(image,"jpg",o);}catch(Exception e){return false;}}public void recycle(){}
}''',
'android/graphics/BitmapFactory.java': '''
public class BitmapFactory {
 public static class Options {public boolean inJustDecodeBounds;public int outWidth,outHeight,inSampleSize=1;}
 public static Bitmap decodeByteArray(byte[] b,int x,int n,Options o){
 try{java.awt.image.BufferedImage i=javax.imageio.ImageIO.read(new java.io.ByteArrayInputStream(b));if(i==null)return null;
 o.outWidth=i.getWidth();o.outHeight=i.getHeight();if(o.inJustDecodeBounds)return null;
 java.awt.image.BufferedImage t=new java.awt.image.BufferedImage(i.getWidth()/o.inSampleSize,i.getHeight()/o.inSampleSize,java.awt.image.BufferedImage.TYPE_INT_RGB);
 java.awt.Graphics g=t.getGraphics();g.drawImage(i,0,0,t.getWidth(),t.getHeight(),null);g.dispose();return new Bitmap(t);}catch(Exception e){return null;}
 }}''',
'com/ceru/music/mobile/LocalMediaPlugin.java': '''
public class LocalMediaPlugin {static android.net.Uri audioUri(String id){return android.net.Uri.parse("content://media/external/audio/media/"+id);}}''',
'com/ceru/music/mobile/MusicFoldersPlugin.java': '''
public class MusicFoldersPlugin {
 static boolean managedUri(android.content.Context c,android.net.Uri u){return u.toString().startsWith("content://downloads/owned/");}
 static java.util.List<android.net.Uri> scanFolders(android.content.Context c){return java.util.Arrays.asList(android.net.Uri.parse("content://docs/tree/Music"));}
 static boolean hasGrant(android.content.Context c,android.net.Uri u,boolean w){return true;}
 static java.io.File legacyFile(android.content.Context c,String raw)throws Exception{java.io.File f=new java.io.File(java.net.URI.create(raw));if(!f.getCanonicalPath().startsWith(c.root.getCanonicalPath()+java.io.File.separator))throw new SecurityException("outside");return f;}
}''',
}
for name, code in stubs.items():
    p = src / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text('package '+str(Path(name).parent).replace('\\', '.').replace('/', '.')+';\n'+code, encoding='utf-8')
target = src / 'com/ceru/music/mobile/LocalArtwork.java'
shutil.copy2(root / 'android/app/src/main/java/com/ceru/music/mobile/LocalArtwork.java', target)
harness = '''package com.ceru.music.mobile;
public class Harness {
 static void ok(boolean b,String s){if(!b)throw new AssertionError(s);System.out.println("PASS "+s);}
 static void denied(android.content.Context c,String id,String uri,boolean grant)throws Exception{
 try{LocalArtwork.source(c,id,uri,grant);throw new AssertionError("should deny");}catch(SecurityException expected){}}
 public static void main(String[] args)throws Exception{
 android.content.Context c=new android.content.Context(new java.io.File(args[0]));
 android.media.MediaMetadataRetriever.picture=java.nio.file.Files.readAllBytes(new java.io.File(args[1]).toPath());
 android.net.Uri u=LocalArtwork.source(c,"42","content://media/external/audio/media/42",true);
 java.io.File f=LocalArtwork.read(c,u);ok(f!=null&&f.length()>0,"embedded bytes decode into a cached JPEG file");
 java.awt.image.BufferedImage image=javax.imageio.ImageIO.read(f);
 ok(image!=null&&image.getWidth()<=512&&image.getHeight()<=512,"thumbnail really decodes and is bounded");
 LocalArtwork.read(c,u);ok(android.media.MediaMetadataRetriever.calls==1,"repeat lookup reuses disk cache");
 android.media.MediaMetadataRetriever.picture=null;ok(LocalArtwork.read(c,LocalMediaPlugin.audioUri("43"))==null,"no embedded image returns no cover");
 android.media.MediaMetadataRetriever.picture=new byte[8*1024*1024+1];ok(LocalArtwork.read(c,LocalMediaPlugin.audioUri("44"))==null,"oversized embedded image refused");
 denied(c,"42",null,false);denied(c,"42","content://media/external/audio/media/99",true);
 denied(c,"folder:x","content://docs/tree/Secret/document/x",true);denied(c,"app:x","file:///outside/private.mp3",true);
 denied(c,"web:x","https://private.example/song",true);ok(true,"revoked media, wrong ID, unauthorized tree, private file and network addresses denied");
 ok(LocalArtwork.source(c,"folder:x","content://docs/tree/Music/document/song",false)!=null,"selected SAF tree is accepted without broad media permission");
 }}'''
p = src / 'com/ceru/music/mobile/Harness.java'
p.write_text(harness, encoding='utf-8')
jdk = Path(r'C:\Program Files\Eclipse Adoptium\jdk-17.0.20.101-hotspot\bin')
commands = [[str(jdk/'javac.exe'),'-encoding','UTF-8','-d',str(classes),*[str(p) for p in src.rglob('*.java')]],
            [str(jdk/'java.exe'),'-cp',str(classes),'com.ceru.music.mobile.Harness',str(out/('workspace-'+uuid.uuid4().hex)),str(root.parent/'evidence/embedded-cover.png')]]
records = []
for command in commands:
    run = subprocess.run(command, capture_output=True, text=True, encoding='utf-8', errors='replace')
    print(run.stdout, run.stderr)
    records.append({'command':command,'exitCode':run.returncode,'stdout':run.stdout,'stderr':run.stderr})
    if run.returncode: break
(out/'runs.json').write_text(json.dumps({'scope':'Actual Java source with MediaMetadataRetriever response double and ImageIO platform decoding; not an Android device run','records':records},indent=2),encoding='utf-8')
raise SystemExit(records[-1]['exitCode'])
