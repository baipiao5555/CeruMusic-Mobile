package com.ceru.music.mobile;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.text.TextUtils;

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

    private static final long MIN_DURATION_MS = 20_000L;

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
    public void scan(PluginCall call) {
        if (!granted()) {
            call.reject("需要「音乐和音频」权限才能扫描本机歌曲", "PERMISSION");
            return;
        }
        JSArray tracks = new JSArray();
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
        String selection = MediaStore.Audio.Media.IS_MUSIC + "!=0 AND "
                + MediaStore.Audio.Media.DURATION + ">=" + MIN_DURATION_MS;
        String order = MediaStore.Audio.Media.TITLE + " COLLATE LOCALIZED ASC";

        Cursor cursor = null;
        try {
            cursor = resolver.query(collection, columns, selection, null, order);
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
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("没有读取本机音乐的权限", "PERMISSION");
        } catch (Exception error) {
            call.reject("扫描失败: " + error.getMessage());
        } finally {
            if (cursor != null) cursor.close();
        }
    }

    /** 供内部使用：把 MediaStore id 换成 content:// 地址。 */
    static Uri audioUri(String id) {
        return ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id));
    }
}
