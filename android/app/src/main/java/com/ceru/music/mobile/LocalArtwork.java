package com.ceru.music.mobile;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.provider.DocumentsContract;
import java.io.File;
import java.io.FileOutputStream;
import java.security.MessageDigest;
import java.util.Arrays;

/** Read embedded covers only from app downloads, authorized SAF trees or media audio. */
final class LocalArtwork {
    static Uri source(Context context, String id, String raw, boolean mediaGranted) throws Exception {
        if (id != null && id.matches("[0-9]+")) {
            if (!mediaGranted) throw new SecurityException("读取媒体库封面需要音频权限");
            Uri media = LocalMediaPlugin.audioUri(id);
            if (raw != null && !raw.isEmpty() && !media.equals(Uri.parse(raw))) throw new SecurityException("曲目地址不一致");
            return media;
        }
        if (raw == null || raw.isEmpty()) throw new IllegalArgumentException("本地曲目地址为空");
        Uri uri = Uri.parse(raw);
        if ("file".equals(uri.getScheme())) return Uri.fromFile(MusicFoldersPlugin.legacyFile(context, raw));
        if (!"content".equals(uri.getScheme())) throw new SecurityException("只读取本地音频封面");
        if (MusicFoldersPlugin.managedUri(context, uri)) return uri;
        for (Uri tree : MusicFoldersPlugin.scanFolders(context)) {
            if (!tree.getAuthority().equals(uri.getAuthority()) || !MusicFoldersPlugin.hasGrant(context, tree, false)) continue;
            try {
                String root = DocumentsContract.getTreeDocumentId(tree);
                String embeddedRoot = DocumentsContract.getTreeDocumentId(uri);
                if (root.equals(embeddedRoot)) return uri; // Provider enforces descendant access.
            } catch (IllegalArgumentException ignored) {}
        }
        throw new SecurityException("该音频不在已授权的音乐目录中");
    }

    static synchronized File read(Context context, Uri uri) throws Exception {
        File directory = new File(context.getCacheDir(), "local-artwork");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("无法创建封面缓存");
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(uri.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
        StringBuilder name = new StringBuilder();
        for (byte b : hash) name.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        File cover = new File(directory, name + ".jpg");
        if (cover.isFile() && cover.length() > 0 && System.currentTimeMillis() - cover.lastModified() < 24 * 60 * 60 * 1000L) return cover;
        MediaMetadataRetriever tags = new MediaMetadataRetriever();
        byte[] picture;
        try { tags.setDataSource(context, uri); picture = tags.getEmbeddedPicture(); }
        finally { try { tags.release(); } catch (Exception ignored) {} }
        if (picture == null || picture.length == 0 || picture.length > 8 * 1024 * 1024) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(picture, 0, picture.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = 1;
        while (Math.max(bounds.outWidth, bounds.outHeight) / options.inSampleSize > 512) options.inSampleSize *= 2;
        Bitmap bitmap = BitmapFactory.decodeByteArray(picture, 0, picture.length, options);
        if (bitmap == null) return null;
        try (FileOutputStream output = new FileOutputStream(cover)) {
            if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 85, output)) throw new Exception("封面解码失败");
        } finally { bitmap.recycle(); }
        // ponytail: bounded disk cache, no index/database for disposable thumbnails.
        File[] files = directory.listFiles();
        if (files != null && files.length > 256) {
            Arrays.sort(files, (left, right) -> Long.compare(left.lastModified(), right.lastModified()));
            for (int index = 0; index < files.length - 256; index++) if (!files[index].equals(cover)) files[index].delete();
        }
        return cover;
    }
}
