package com.ceru.music.mobile;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.media.MediaMetadataRetriever;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.webkit.MimeTypeMap;
import java.io.File;
import java.util.Locale;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * 本机音乐：通过 MediaStore 扫描设备上的音频文件。
 *
 * <p>只读元数据，不复制文件；播放时由 {@link AudioCacheServer} 的 /local 路由
 * 按 MediaStore id 打开 content:// 流，WebView 里的 audio 就能像在线歌曲一样
 * 拖进度、续播。</p>
 *
 * <p>权限：Android 13 起是 READ_MEDIA_AUDIO（细分到音频），更早版本是
 * READ_EXTERNAL_STORAGE。两个别名分开声明，按系统版本请求其一。</p>
 */
@CapacitorPlugin(
        name = "LocalMedia",
        permissions = {
                @Permission(alias = "audio33", strings = {Manifest.permission.READ_MEDIA_AUDIO}),
                @Permission(alias = "audioLegacy", strings = {Manifest.permission.READ_EXTERNAL_STORAGE})
        }
)
public class LocalMediaPlugin extends Plugin {
    private final java.util.concurrent.ExecutorService scanner = java.util.concurrent.Executors.newSingleThreadExecutor(r -> { Thread t=new Thread(r,"ceru-local-scan");t.setDaemon(true);return t; });

    private void appendAppDownloads(JSArray tracks) {
        File external = getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC);
        File internal = new File(getContext().getFilesDir(), "Music");
        for (File file : LocalAudioFiles.list(external, internal)) {
            JSObject item = new JSObject();
            String uri = Uri.fromFile(file).toString();
            String name = file.getName();
            int dot = name.lastIndexOf('.');
            item.put("id", "app:" + uri);
            item.put("origin", "download");
            item.put("uri", uri);
            item.put("title", dot > 0 ? name.substring(0, dot) : name);
            item.put("artist", "未知歌手");
            item.put("album", "");
            item.put("durationMs", 0L);
            item.put("size", file.length());
            String extension = dot >= 0 ? name.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
            String mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension);
            item.put("mime", mime == null ? "audio/mpeg" : mime);
            MediaMetadataRetriever metadata = new MediaMetadataRetriever();
            try {
                metadata.setDataSource(file.getAbsolutePath());
                String title = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE);
                String artist = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST);
                String album = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM);
                String duration = metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
                if (!TextUtils.isEmpty(title)) item.put("title", title);
                if (!TextUtils.isEmpty(artist)) item.put("artist", artist);
                if (!TextUtils.isEmpty(album)) item.put("album", album);
                if (!TextUtils.isEmpty(duration)) item.put("durationMs", Long.parseLong(duration));
            } catch (Exception ignored) { /* Missing tags never hide an existing audio file. */ }
            finally { try { metadata.release(); } catch (Exception ignored) {} }
            tracks.put(item);
        }
    }

    private boolean granted() {
        if (Build.VERSION.SDK_INT >= 33) {
            return getPermissionState("audio33") == PermissionState.GRANTED;
        }
        return getPermissionState("audioLegacy") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void check(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", granted());
        call.resolve(result);
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (granted()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        String alias = Build.VERSION.SDK_INT >= 33 ? "audio33" : "audioLegacy";
        requestPermissionForAlias(alias, call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("granted", granted());
        call.resolve(result);
    }

    @PluginMethod
    public void scan(PluginCall call) { scanner.execute(() -> scanNow(call)); }

    private void scanNow(PluginCall call) {
        JSArray tracks = new JSArray();
        appendAppDownloads(tracks);
        MusicFoldersPlugin.appendManaged(getContext(), tracks);
        StringBuilder folderErrors = new StringBuilder();
        java.util.Set<String> seen = new java.util.HashSet<>(); int[] visited = {0};
        for (Uri tree : !"all".equals(call.getString("source")) ? MusicFoldersPlugin.scanFolders(getContext()) : java.util.Collections.<Uri>emptyList()) {
            try {
                if (!MusicFoldersPlugin.hasGrant(getContext(), tree, false)) throw new Exception("文件夹授权失效，请重新选择：" + MusicFoldersPlugin.folderLabel(getContext(), tree));
                MusicFoldersPlugin.appendFolder(getContext(),tree,tracks,seen,visited,0,android.provider.DocumentsContract.getTreeDocumentId(tree));
            } catch (Exception error) { if(folderErrors.length()>0)folderErrors.append("；");folderErrors.append(error.getMessage()); }
        }
        if (!"all".equals(call.getString("source")) || !granted()) {
            JSObject result=new JSObject(); result.put("tracks",tracks);result.put("granted",granted());
            if(folderErrors.length()>0)result.put("error",folderErrors.toString());call.resolve(result);return;
        }
        if (!granted()) {
            JSObject result = new JSObject();
            result.put("tracks", tracks);
            result.put("granted", false);
            call.resolve(result);
            return;
        }
        ContentResolver resolver = getContext().getContentResolver();
        Uri collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        String[] columns = {
                MediaStore.Audio.Media._ID,
                MediaStore.Audio.Media.TITLE,
                MediaStore.Audio.Media.ARTIST,
                MediaStore.Audio.Media.ALBUM,
                MediaStore.Audio.Media.DURATION,
                MediaStore.Audio.Media.SIZE,
                MediaStore.Audio.Media.MIME_TYPE
        };
        // IS_MUSIC and duration tags are often missing, especially for newly copied/downloaded files.
        String selection = MediaStore.Audio.Media.SIZE + ">0";
        // MediaStore validates sort tokens; COLLATE LOCALIZED is rejected on recent Android.
        String order = MediaStore.Audio.Media.TITLE + " ASC";

        java.util.List<String> classified = new java.util.ArrayList<>(java.util.Arrays.asList(columns));
        classified.addAll(java.util.Arrays.asList("is_music", "is_ringtone", "is_notification", "is_alarm"));
        if (Build.VERSION.SDK_INT >= 29) classified.add("relative_path");
        if (Build.VERSION.SDK_INT >= 31) classified.add("is_recording");
        Cursor cursor = null;
        try {
            try { cursor = resolver.query(collection, classified.toArray(new String[0]), selection, null, order); }
            catch (Exception error) {
                String message=String.valueOf(error.getMessage()).toLowerCase(java.util.Locale.ROOT);
                if (!message.contains("column")) throw error;
                // An OEM may omit classification columns. Keep the valid base query, not a SQL-error mask.
                cursor = resolver.query(collection, columns, selection, null, order);
            }
            if (cursor != null) {
                int idIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                int titleIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                int artistIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                int albumIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                int durationIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                int sizeIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
                int mimeIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idIndex);
                    String title = cursor.getString(titleIndex);
                    String artist = cursor.getString(artistIndex);
                    String album = cursor.getString(albumIndex);
                    long duration = cursor.getLong(durationIndex);
                    long size = cursor.getLong(sizeIndex);
                    String mime = cursor.getString(mimeIndex);
                    if (TextUtils.isEmpty(title)) title = "未命名曲目";
                    if (TextUtils.isEmpty(artist) || "<unknown>".equals(artist)) artist = "未知歌手";
                    JSObject item = new JSObject();
                    item.put("id", String.valueOf(id));
                    item.put("origin", "media");
                    putFlag(cursor,item,"is_music","isMusic");
                    putFlag(cursor,item,"is_recording","isRecording");
                    boolean tone = flag(cursor,"is_ringtone") || flag(cursor,"is_notification") || flag(cursor,"is_alarm");
                    item.put("isTone",tone);
                    int pathIndex=cursor.getColumnIndex("relative_path");
                    if(pathIndex>=0)item.put("relativePath",cursor.getString(pathIndex));
                    item.put("uri", ContentUris.withAppendedId(collection, id).toString());
                    item.put("title", title);
                    item.put("artist", artist);
                    item.put("album", album == null ? "" : album);
                    item.put("durationMs", duration);
                    item.put("size", size);
                    item.put("mime", mime == null ? "audio/mpeg" : mime);
                    tracks.put(item);
                }
            }
            JSObject result = new JSObject();
            result.put("tracks", tracks);
            result.put("granted", true);
            if(folderErrors.length()>0)result.put("error",folderErrors.toString());
            call.resolve(result);
        } catch (SecurityException error) {
            JSObject result = new JSObject();
            result.put("tracks", tracks);
            result.put("granted", false);
            result.put("error", "系统媒体库读取权限已被撤回；应用下载仍可使用");
            call.resolve(result);
        } catch (Exception error) {
            JSObject result = new JSObject();
            result.put("tracks", tracks);
            result.put("granted", true);
            result.put("error", "媒体库扫描失败: " + error.getMessage());
            call.resolve(result);
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    private static boolean flag(Cursor cursor, String column) { int index=cursor.getColumnIndex(column);return index>=0 && "1".equals(cursor.getString(index)); }
    private static void putFlag(Cursor cursor, JSObject item, String column, String key) {
        int index=cursor.getColumnIndex(column);if(index>=0 && cursor.getString(index)!=null)item.put(key,"1".equals(cursor.getString(index)));
    }

    /** 供内部使用：把 MediaStore id 换成 content:// 地址。 */
    static Uri audioUri(String id) {
        return ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id));
    }
}
