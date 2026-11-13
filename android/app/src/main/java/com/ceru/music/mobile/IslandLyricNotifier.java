package com.ceru.music.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.PorterDuff;
import android.graphics.PorterDuffXfermode;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.os.Bundle;

import org.json.JSONObject;

/**
 * 把当前歌词行发布成 Android 16 的「实时更新」通知。
 *
 * <p>HyperOS 的岛只对两类来源渲染歌词：焦点通知（要小米白名单）与系统原生的
 * 实时更新（ongoing + shortCriticalText，无需权限）。这里走后者：从 Android 16
 * 起系统会把请求提升的常驻通知画成岛卡片，主文案就是 shortCriticalText，
 * 歌词直接写进这一段即可。</p>
 *
 * <p>与媒体卡片分开的通道和 ID：媒体卡片继续显示歌名与封面，歌词走这张，
 * 两者互不覆盖。API 36 以下的系统没有提升接口，退化为普通常驻通知。</p>
 */
class IslandLyricNotifier {

    private static final String CHANNEL_ID = "ceru_island_lyric";
    private static final int NOTIFICATION_ID = 2302;
    private static final long MIN_INTERVAL_MS = 220L;

    private final Context context;
    private String lastLine = "";
    private String lastSong = "";
    private long lastAt = 0;
    private boolean posted = false;

    IslandLyricNotifier(Context context) {
        this.context = context.getApplicationContext();
        createChannel();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "岛歌词",
                NotificationManager.IMPORTANCE_HIGH
        );
        channel.setSound(null, null);
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    /**
     * 刷新岛上的那一行歌词。
     *
     * @param line     当前歌词行（整行，岛上就显示这一句）
     * @param title    歌名
     * @param artist   歌手
     * @param artwork  封面，可空
     * @param playing  是否在播
     * @param position 毫秒
     * @param duration 毫秒
     */
    void update(
            String line,
            String title,
            String artist,
            Bitmap artwork,
            boolean playing,
            long position,
            long duration
    ) {
        String safeLine = line == null ? "" : line.trim();
        String songName = title == null ? "" : title;
        String song = songName + "|" + (artist == null ? "" : artist);
        long now = System.currentTimeMillis();
        boolean lineChanged = !safeLine.equals(lastLine);
        boolean songChanged = !song.equals(lastSong);
        if (!lineChanged && !songChanged && now - lastAt < MIN_INTERVAL_MS) return;
        lastLine = safeLine;
        lastSong = song;
        lastAt = now;

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, CHANNEL_ID)
                : new Notification.Builder(context);

        builder.setSmallIcon(icon(artwork))
                .setOngoing(playing)
                .setOnlyAlertOnce(true)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setCategory(Notification.CATEGORY_STATUS)
                .setContentIntent(contentIntent())
                .setContentTitle(songName)
                .setContentText(safeLine.isEmpty() ? songName : safeLine)
                .setSubText(artist == null || artist.isEmpty() ? null : artist)
                .setShowWhen(false);

        // 岛卡片的主文案。API 36 起平台才认识这段文本，低版本直接跳过；
        // 常驻 + STATUS 分类 + 进度条就是系统判定的「实时更新」形态。
        if (Build.VERSION.SDK_INT >= 36) {
            try {
                builder.setShortCriticalText(safeLine.isEmpty() ? songName : safeLine);
            } catch (Throwable ignored) {
            }
        }

        if (artwork != null) builder.setLargeIcon(artwork);

        if (duration > 1000) {
            int progress = (int) Math.max(0, Math.min(1000, Math.round(position * 1000.0 / duration)));
            builder.setProgress(1000, progress, false);
        }

        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_ONGOING_EVENT | Notification.FLAG_NO_CLEAR;

        // HyperOS 的焦点通知通道：同一张卡片再挂一份 miui.focus.param。
        // 有白名单的机器会把它画成岛卡片；没有白名单时这段会被系统忽略，
        // 卡片仍然按常驻通知显示，不会多出第二张。
        if (isHyperOs()) {
            try {
                notification.extras.putBoolean("mFocusNotification", true);
                notification.extras.putString(
                        "miui.focus.param",
                        focusParam(safeLine.isEmpty() ? songName : safeLine, songName, position, duration)
                );
                Bundle pics = new Bundle();
                Icon album = icon(artwork);
                if (album != null) pics.putParcelable("miui.focus.pic_album", album);
                notification.extras.putBundle("miui.focus.pics", pics);
            } catch (Throwable ignored) {
            }
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            manager.notify(NOTIFICATION_ID, notification);
            posted = true;
        } catch (Throwable ignored) {
            // 通知权限被关时静默失败，不影响播放。
        }
    }

    void hide() {
        if (!posted) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            try {
                manager.cancel(NOTIFICATION_ID);
            } catch (Throwable ignored) {
            }
        }
        posted = false;
        lastLine = "";
        lastSong = "";
    }

    /** 只有小米系的系统才需要挂焦点通知参数，其它机型不塞无意义的 extras。 */
    private boolean isHyperOs() {
        String brand = Build.BRAND == null ? "" : Build.BRAND.toLowerCase();
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase();
        return brand.contains("xiaomi") || brand.contains("redmi") || brand.contains("poco")
                || manufacturer.contains("xiaomi");
    }

    /**
     * 焦点通知的 param_v2。字段与 HyperOS 岛通知模板一致：大岛左侧封面+文本、
     * 右侧当前歌词，小岛放进度环，baseInfo 给通知栏用。
     */
    private String focusParam(String line, String song, long position, long duration) {
        int progress = 0;
        if (duration > 1000) {
            progress = (int) Math.max(0, Math.min(100, Math.round(position * 100.0 / duration)));
        }
        String left = "";
        String right = line;
        if (line.length() > 9) {
            int cut = (line.length() + 1) / 2;
            left = line.substring(0, cut);
            right = line.substring(cut);
        }
        try {
            JSONObject paramV2 = new JSONObject();
            paramV2.put("islandFirstFloat", false);
            paramV2.put("updatable", true);
            paramV2.put("reopen", "reopen");
            paramV2.put("isShowNotification", false);

            JSONObject island = new JSONObject();

            JSONObject big = new JSONObject();
            JSONObject imageTextLeft = new JSONObject();
            imageTextLeft.put("type", 1);
            JSONObject textLeft = new JSONObject();
            textLeft.put("title", left.isEmpty() ? song : left);
            textLeft.put("showHighlightColor", false);
            imageTextLeft.put("textInfo", textLeft);
            JSONObject picInfo = new JSONObject();
            picInfo.put("type", 1);
            picInfo.put("pic", "miui.focus.pic_album");
            imageTextLeft.put("picInfo", picInfo);
            big.put("imageTextInfoLeft", imageTextLeft);
            JSONObject bigText = new JSONObject();
            bigText.put("title", right);
            bigText.put("showHighlightColor", false);
            big.put("textInfo", bigText);
            island.put("bigIslandArea", big);

            JSONObject small = new JSONObject();
            JSONObject combine = new JSONObject();
            JSONObject progressInfo = new JSONObject();
            progressInfo.put("progress", progress);
            progressInfo.put("isCCW", true);
            combine.put("progressInfo", progressInfo);
            small.put("combinePicInfo", combine);
            island.put("smallIslandArea", small);

            paramV2.put("param_island", island);

            JSONObject baseInfo = new JSONObject();
            baseInfo.put("type", 2);
            baseInfo.put("title", song);
            baseInfo.put("content", line);
            paramV2.put("baseInfo", baseInfo);

            paramV2.put("aodTitle", line);
            paramV2.put("aodPic", "miui.focus.pic_album");

            JSONObject root = new JSONObject();
            root.put("param_v2", paramV2);
            return root.toString();
        } catch (Throwable error) {
            return "";
        }
    }

    private PendingIntent contentIntent() {        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(context, 21, intent, flags);
    }

    /** 封面裁成圆角方块当作小图标，没有封面就用应用图标。 */
    private Icon icon(Bitmap artwork) {
        Bitmap rounded = artwork == null ? null : roundRect(artwork);
        if (rounded != null) return Icon.createWithBitmap(rounded);
        return Icon.createWithResource(context, R.drawable.ic_stat_music);
    }

    private Bitmap roundRect(Bitmap source) {
        try {
            int size = 128;
            int w = source.getWidth();
            int h = source.getHeight();
            if (w <= 0 || h <= 0) return null;
            int crop = Math.min(w, h);
            int x = (w - crop) / 2;
            int y = (h - crop) / 2;
            Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(output);
            float radius = size / 4f;
            Paint mask = new Paint(Paint.ANTI_ALIAS_FLAG);
            canvas.drawRoundRect(new RectF(0, 0, size, size), radius, radius, mask);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            paint.setFilterBitmap(true);
            paint.setXfermode(new PorterDuffXfermode(PorterDuff.Mode.SRC_IN));
            canvas.drawBitmap(source, new Rect(x, y, x + crop, y + crop), new Rect(0, 0, size, size), paint);
            return output;
        } catch (Throwable ignored) {
            return null;
        }
    }
}
