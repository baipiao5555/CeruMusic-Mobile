package com.ceru.music.mobile;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.webkit.MimeTypeMap;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.*;

/** User-granted SAF folders, plus app-owned public downloads. No all-files permission. */
@CapacitorPlugin(name = "MusicFolders")
public class MusicFoldersPlugin extends Plugin {
    static final String PUBLIC_FOLDER = "Music/CeruMusic/";
    private static SharedPreferences prefs(Context context) { return context.getSharedPreferences("ceru.music.folders", Context.MODE_PRIVATE); }
    static List<Uri> scanFolders(Context context) {
        List<Uri> result = new ArrayList<>();
        for (String raw : prefs(context).getStringSet("scan", Collections.emptySet())) result.add(Uri.parse(raw));
        String download = prefs(context).getString("download", "");
        boolean present=false;for(Uri uri:result)if(uri.toString().equals(download))present=true;
        if (!download.isEmpty() && !present) result.add(Uri.parse(download));
        return result;
    }
    static String folderLabel(Context context, Uri tree) {
        try {
            String id = DocumentsContract.getTreeDocumentId(tree);
            if (tree.getAuthority().equals("com.android.externalstorage.documents")) {
                String[] parts = id.split(":", 2);
                return (parts[0].equals("primary") ? "内部存储" : "存储卷 " + parts[0]) + (parts.length > 1 && !parts[1].isEmpty() ? " / " + parts[1].replace("/", " / ") : "");
            }
            try (Cursor c = context.getContentResolver().query(DocumentsContract.buildDocumentUriUsingTree(tree,id), new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null,null,null)) {
                if (c != null && c.moveToFirst()) return c.getString(0);
            }
        } catch (Exception ignored) { }
        return "已选择的文件夹";
    }
    static boolean hasGrant(Context context, Uri tree, boolean write) {
        for(android.content.UriPermission p:context.getContentResolver().getPersistedUriPermissions())if(p.getUri().equals(tree)&&p.isReadPermission()&&(!write||p.isWritePermission()))return true;
        return false;
    }
    @PluginMethod public void get(PluginCall call) {
        JSObject result = new JSObject(); JSArray folders = new JSArray();
        for (String raw : prefs(getContext()).getStringSet("scan", Collections.emptySet())) {
            Uri uri = Uri.parse(raw); JSObject item = new JSObject();
            item.put("uri",raw); item.put("label",folderLabel(getContext(),uri)); item.put("available",hasGrant(getContext(),uri,false)); folders.put(item);
        }
        String raw = prefs(getContext()).getString("download", "");
        JSObject download = new JSObject(); download.put("uri",raw);
        download.put("label",raw.isEmpty() ? (Build.VERSION.SDK_INT >= 29 ? "内部存储 / Music / CeruMusic" : "请先选择下载文件夹") : folderLabel(getContext(),Uri.parse(raw)));
        download.put("available",raw.isEmpty() ? Build.VERSION.SDK_INT >= 29 : hasGrant(getContext(),Uri.parse(raw),true));
        download.put("isDefault",raw.isEmpty()); result.put("folders",folders); result.put("download",download); call.resolve(result);
    }
    @PluginMethod public void pick(PluginCall call) {
        String mode = call.getString("mode", "scan");
        if (!mode.equals("scan") && !mode.equals("download")) { call.reject("未知文件夹用途"); return; }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        if (mode.equals("download")) intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        if (Build.VERSION.SDK_INT >= 26) {
            String previous = prefs(getContext()).getString("download", "");
            if (!previous.isEmpty()) intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI, Uri.parse(previous));
        }
        startActivityForResult(call,intent,"folderPicked");
    }
    @ActivityCallback private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) { JSObject cancelled = new JSObject(); cancelled.put("cancelled",true); call.resolve(cancelled); return; }
        Uri uri = data.getData(); boolean download = "download".equals(call.getString("mode"));
        try {
            if (!"content".equals(uri.getScheme())) throw new Exception("请选择系统文件管理器中的文件夹");
            // getTreeDocumentId is API 21; isTreeUri is API 24 and crashes Android 6.
            DocumentsContract.getTreeDocumentId(uri);
            int wanted = Intent.FLAG_GRANT_READ_URI_PERMISSION | (download ? Intent.FLAG_GRANT_WRITE_URI_PERMISSION : 0);
            int flags = data.getFlags() & wanted;
            if ((flags & Intent.FLAG_GRANT_READ_URI_PERMISSION) == 0 || (download && (flags & Intent.FLAG_GRANT_WRITE_URI_PERMISSION) == 0)) throw new Exception("该文件夹没有所需的读取/写入授权");
            getContext().getContentResolver().takePersistableUriPermission(uri,flags);
            if (download) prefs(getContext()).edit().putString("download",uri.toString()).commit();
            else { Set<String> folders = new LinkedHashSet<>(prefs(getContext()).getStringSet("scan",Collections.emptySet())); if (folders.size() >= 20 && !folders.contains(uri.toString())) throw new Exception("最多选择 20 个扫描文件夹"); folders.add(uri.toString()); prefs(getContext()).edit().putStringSet("scan",folders).commit(); }
            JSObject selected = new JSObject(); selected.put("cancelled",false); selected.put("uri",uri.toString()); selected.put("label",folderLabel(getContext(),uri)); call.resolve(selected);
        } catch (Exception error) { call.reject(error.getMessage()); }
    }
    @PluginMethod public void removeScanFolder(PluginCall call) {
        Set<String> folders = new LinkedHashSet<>(prefs(getContext()).getStringSet("scan",Collections.emptySet())); folders.remove(call.getString("uri"));
        prefs(getContext()).edit().putStringSet("scan",folders).commit(); call.resolve();
    }
    @PluginMethod public void resetDownloadFolder(PluginCall call) { prefs(getContext()).edit().remove("download").commit(); call.resolve(); }
    private static Set<String> managed(Context c) { return new LinkedHashSet<>(prefs(c).getStringSet("downloads",Collections.emptySet())); }
    static synchronized void remember(Context c, Uri uri) throws Exception { Set<String> set=managed(c);set.add(uri.toString());if(!prefs(c).edit().putStringSet("downloads",set).commit())throw new Exception("无法记录下载文件，保存已取消"); }
    static synchronized void forget(Context c, Uri uri) { Set<String> set=managed(c);set.remove(uri.toString());prefs(c).edit().putStringSet("downloads",set).commit(); }
    static boolean managedUri(Context c, Uri uri) { return managed(c).contains(uri.toString()); }
    static String mime(String name) { int dot=name.lastIndexOf('.');String value=dot < 0 ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot+1).toLowerCase(Locale.ROOT));return value == null ? "audio/mpeg" : value; }
    static boolean audio(String name, String mime) { return name.toLowerCase(Locale.ROOT).matches(".*\\.(mp3|flac|m4a|aac|ogg|opus|wav|wma|aiff|aif)") || (mime != null && mime.startsWith("audio/")); }
    static JSObject entry(Context context, Uri uri, String id, String title, long size, String mime) {
        JSObject item=new JSObject();item.put("origin","folder");item.put("id",id);item.put("uri",uri.toString());item.put("title",title.replaceFirst("\\.[A-Za-z0-9]{2,5}$",""));item.put("artist","未知歌手");item.put("album","");item.put("durationMs",0L);item.put("size",size);item.put("mime",mime);
        MediaMetadataRetriever tags=new MediaMetadataRetriever();try {
            tags.setDataSource(context,uri);
            String value=tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);if(!TextUtils.isEmpty(value))item.put("title",value);
            value=tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);if(!TextUtils.isEmpty(value))item.put("artist",value);
            value=tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);if(!TextUtils.isEmpty(value))item.put("album",value);
            value=tags.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);if(!TextUtils.isEmpty(value))item.put("durationMs",Long.parseLong(value));
        }catch(Exception ignored){}finally{try{tags.release();}catch(Exception ignored){}}
        return item;
    }
    static void appendManaged(Context context, JSArray tracks) {
        for(String raw:managed(context))try{
            Uri uri=Uri.parse(raw);
            try(Cursor c=context.getContentResolver().query(uri,new String[]{"_display_name","_size"},null,null,null)){
                if(c!=null && c.moveToFirst() && c.getLong(1)>0){JSObject item=entry(context,uri,"download:"+raw,c.getString(0),c.getLong(1),mime(c.getString(0)));item.put("origin","download");tracks.put(item);}
            }
        }catch(Exception ignored){ /* Deleted or revoked files must not hide other downloads. */ }
    }
    static void appendFolder(Context context, Uri tree, JSArray tracks, Set<String> seen, int[] visited, int depth, String documentId) throws Exception {
        if(depth>16 || visited[0]>=10000)throw new Exception("文件夹扫描达到 10000 项或 16 层上限，请选择更具体的音乐文件夹");
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,documentId);
        List<String> directories=new ArrayList<>();
        try(Cursor c=context.getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME,DocumentsContract.Document.COLUMN_MIME_TYPE,DocumentsContract.Document.COLUMN_SIZE},null,null,null)) {
            if(c==null)throw new Exception("无法读取文件夹："+folderLabel(context,tree));
            while(c.moveToNext()) {
                if(++visited[0]>10000)throw new Exception("文件夹扫描达到 10000 项上限，请选择更具体的音乐文件夹");
                String id=c.getString(0),name=c.getString(1),type=c.getString(2);
                if(DocumentsContract.Document.MIME_TYPE_DIR.equals(type)){directories.add(id);continue;}
                Uri uri=DocumentsContract.buildDocumentUriUsingTree(tree,id);
                if(audio(name,type) && c.getLong(3)>0 && seen.add(uri.toString()))tracks.put(entry(context,uri,"folder:"+uri,name,c.getLong(3),mime(name)));
            }
        }
        for(String id:directories)if(seen.add("dir:"+tree.getAuthority()+":"+id))appendFolder(context,tree,tracks,seen,visited,depth+1,id);
    }
    static final class Target {
        final Context context; final Uri uri; final String label; final boolean pending;
        Target(Context c, Uri u, String label, boolean pending){context=c;uri=u;this.label=label;this.pending=pending;}
        OutputStream open() throws Exception {OutputStream stream=context.getContentResolver().openOutputStream(uri,"w");if(stream==null)throw new Exception("无法写入下载文件夹");return stream;}
        JSObject finish(long size) throws Exception {
            if(pending){ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.IS_PENDING,0);if(context.getContentResolver().update(uri,values,null,null)!=1)throw new Exception("无法完成共享音乐文件发布");}
            remember(context,uri);JSObject result=new JSObject();result.put("path",uri.toString());result.put("size",size);result.put("location",label);
            try(Cursor c=context.getContentResolver().query(uri,new String[]{"_display_name"},null,null,null)){if(c==null || !c.moveToFirst())throw new Exception("下载文件不存在");result.put("fileName",c.getString(0));}return result;
        }
        void abort(){try{deleteFile(context,uri);}catch(Exception ignored){}forget(context,uri);}
    }
    static synchronized Target create(Context context, String name) throws Exception {
        String raw=prefs(context).getString("download","");Uri uri;
        if(!raw.isEmpty()){
            Uri tree=Uri.parse(raw);if(!hasGrant(context,tree,true))throw new Exception("下载文件夹授权已失效，请重新选择文件夹；不会改存其他目录");
            uri=DocumentsContract.createDocument(context.getContentResolver(),DocumentsContract.buildDocumentUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree)),mime(name),name);
            if(uri==null)throw new Exception("无法在选择的文件夹创建歌曲");return new Target(context,uri,folderLabel(context,tree),false);
        }
        if(Build.VERSION.SDK_INT<29)throw new Exception("请先选择下载文件夹，再下载音乐");
        ContentValues values=new ContentValues();values.put(MediaStore.MediaColumns.DISPLAY_NAME,name);values.put(MediaStore.MediaColumns.MIME_TYPE,mime(name));values.put(MediaStore.MediaColumns.RELATIVE_PATH,PUBLIC_FOLDER);values.put(MediaStore.MediaColumns.IS_PENDING,1);
        uri=context.getContentResolver().insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new Exception("无法创建共享音乐文件");return new Target(context,uri,"内部存储 / Music / CeruMusic",true);
    }
    static boolean deleteFile(Context context, Uri uri) throws Exception {
        if(DocumentsContract.isDocumentUri(context,uri))return DocumentsContract.deleteDocument(context.getContentResolver(),uri);
        return context.getContentResolver().delete(uri,null,null)>0;
    }
    static File legacyFile(Context context, String path) throws Exception {
        File file=new File(path.startsWith("file:")?Uri.parse(path).getPath():path);String canonical=file.getCanonicalPath();
        File[] roots={context.getExternalFilesDir(Environment.DIRECTORY_MUSIC),new File(context.getFilesDir(),"Music")};
        for(File root:roots)if(root!=null && canonical.startsWith(root.getCanonicalPath()+File.separator))return file;
        throw new Exception("文件不在应用下载目录中");
    }
}
