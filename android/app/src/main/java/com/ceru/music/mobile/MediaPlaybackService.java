package com.ceru.music.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.util.LruCache;

import io.github.proify.lyricon.lyric.model.RichLyricLine;
import io.github.proify.lyricon.lyric.model.Song;
import io.github.proify.lyricon.provider.LyriconFactory;
import io.github.proify.lyricon.provider.LyriconProvider;
import io.github.proify.lyricon.provider.ProviderInfo;
import io.github.proify.lyricon.provider.RemotePlayer;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaPlaybackService extends Service {
    public static final String ACTION_START = "com.ceru.music.mobile.action.START";
    public static final String ACTION_UPDATE = "com.ceru.music.mobile.action.UPDATE";
    public static final String ACTION_PROGRESS = "com.ceru.music.mobile.action.PROGRESS";
    public static final String ACTION_SEEK = "com.ceru.music.mobile.action.SEEK";
    public static final String ACTION_LYRICS = "com.ceru.music.mobile.action.LYRICS";
    public static final String ACTION_STOP = "com.ceru.music.mobile.action.STOP";
    public static final String ACTION_TOGGLE = "com.ceru.music.mobile.action.TOGGLE";
    public static final String ACTION_PREVIOUS = "com.ceru.music.mobile.action.PREVIOUS";
    public static final String ACTION_NEXT = "com.ceru.music.mobile.action.NEXT";

    private static final String CHANNEL_ID = "ceru_music_playback";
    private static final int NOTIFICATION_ID = 2301;
    /** Lyricon 位置刷新节拍，以及读取间隔。 */
    private static final long LYRICON_TICK_MS = 500L;
    /** 进度跳变超过这个值就当作主动 seek，避免中心服务平滑追进度造成滞后。 */
    private static final long LYRICON_SEEK_JUMP_MS = 2000L;
    private static final int MAX_ARTWORK_BYTES = 16 * 1024 * 1024;
    private static final int MAX_ARTWORK_SIZE = 1024;
    private static final String ARTWORK_USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

    private static final LruCache<String, Bitmap> ARTWORK_CACHE =
            new LruCache<String, Bitmap>(8 * 1024 * 1024) {
                @Override
                protected int sizeOf(String key, Bitmap value) {
                    return value.getByteCount();
                }
            };

    public interface ActionListener {
        void onAction(String action);
    }

    private static final class LyricLineData {
        final long start;
        final long end;
        final String text;
        final String translation;

        LyricLineData(long start, long end, String text, String translation) {
            this.start = start;
            this.end = end;
            this.text = text;
            this.translation = translation;
        }
    }

    private static ActionListener actionListener;
    /** Lyrics can arrive before the foreground service starts; apply them then. */
    private static String pendingLyrics;

    /** Small native breadcrumb buffer exposed through the BackgroundAudio plugin. */
    private static final int MAX_DIAGNOSTICS = 300;
    private static final ArrayDeque<String> DIAGNOSTICS = new ArrayDeque<>();
    private static final Object DIAGNOSTICS_LOCK = new Object();
    private static final SimpleDateFormat DIAGNOSTICS_TIME =
            new SimpleDateFormat("HH:mm:ss.SSS", Locale.US);

    private static void recordDiagnostic(String area, String message) {
        synchronized (DIAGNOSTICS_LOCK) {
            DIAGNOSTICS.addLast(DIAGNOSTICS_TIME.format(new Date()) + " | " + area + " | " + message);
            while (DIAGNOSTICS.size() > MAX_DIAGNOSTICS) DIAGNOSTICS.removeFirst();
        }
    }

    /** Snapshot of native lyric/playback diagnostics, oldest first. */
    public static String[] diagnosticsSnapshot() {
        synchronized (DIAGNOSTICS_LOCK) {
            return DIAGNOSTICS.toArray(new String[0]);
        }
    }

    public static void setActionListener(ActionListener listener) {
        actionListener = listener;
    }

    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private String title = "澜音";
    private String artist = "";
    private String album = "";
    private String mediaId = "";
    private String artworkUrl = "";
    private String colorOsLyric;
    private boolean lyricsEnabled = true;
    private boolean lyricsTranslation = true;
    private LyriconProvider lyriconProvider;
    private long lyricGeneration = 0;
    /** 上一次成功同步给 Lyricon 的播放状态与位置。 */
    private Boolean lyriconPlaying;
    private long lyriconPosition = -1;
    private long lastLyriconDiagnosticAt = 0;
    private final List<LyricLineData> lyricLines = new ArrayList<>();
    private Bitmap artwork;
    private String loadingArtworkUrl = "";
    private boolean playing = false;
    private boolean pauseOnNoisy = true;
    private boolean foregroundStarted = false;
    private long position = 0;
    private long positionBaseRealtime = 0;
    private long duration = 0;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();

    /** Wired/Bluetooth audio disconnected: pause when the user enabled it. */
    private final BroadcastReceiver noisyReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())
                    && pauseOnNoisy && playing) {
                emit("pause");
            }
        }
    };

    private final Runnable progressTicker = new Runnable() {
        @Override
        public void run() {
            if (!playing) return;
            updatePlaybackState();
            mainHandler.postDelayed(this, 1000);
        }
    };

    /**
     * Lyricon 需要比通知栏更高频的位置更新。这里只写共享内存，
     * 不走通知/MediaSession，成本很低。
     */
    private final Runnable lyricTicker = new Runnable() {
        @Override
        public void run() {
            if (!playing || !lyricsEnabled || lyricLines.isEmpty()) return;
            pushLyriconState(false);
            mainHandler.postDelayed(this, LYRICON_TICK_MS);
        }
    };

    private void emit(String action) {
        ActionListener listener = actionListener;
        if (listener != null) listener.onAction(action);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CeruMusic:Playback");
            wakeLock.setReferenceCounted(false);
        }
        mediaSession = new MediaSession(this, "CeruMusic");
        mediaSession.setFlags(
                MediaSession.FLAG_HANDLES_MEDIA_BUTTONS
                        | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setSessionActivity(contentIntent());
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override
            public void onPlay() {
                emit("play");
            }

            @Override
            public void onPause() {
                emit("pause");
            }

            @Override
            public void onSkipToNext() {
                emit("next");
            }

            @Override
            public void onSkipToPrevious() {
                emit("previous");
            }

            @Override
            public void onSeekTo(long pos) {
                emit("seek:" + pos);
            }

            @Override
            public void onStop() {
                emit("stop");
            }
        });
        mediaSession.setActive(true);
        registerReceiver(noisyReceiver, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_UPDATE;

        if (ACTION_STOP.equals(action)) {
            stopPlayback();
            return START_NOT_STICKY;
        }

        if (ACTION_PROGRESS.equals(action)) {
            if (!foregroundStarted) {
                stopSelf();
                return START_NOT_STICKY;
            }
            if (intent != null) {
                long next = intent.getLongExtra("position", position);
                // WebView timers can be throttled in the background and report
                // an older position after the native ticker already advanced.
                // Accepting it rewinds the shared lyric timeline to the first
                // lines. Only a deliberate seek (ACTION_SEEK) may go backwards.
                if (!playing || next >= currentPosition()) {
                    setPosition(next);
                } else {
                    String message = "ignore stale progress " + next + " < " + currentPosition();
                    Log.d("CeruLyrics", message);
                    recordDiagnostic("progress", message);
                }
                if (intent.hasExtra("duration")) duration = intent.getLongExtra("duration", duration);
            }
            updatePlaybackState();
            return START_STICKY;
        }

        if (ACTION_SEEK.equals(action)) {
            if (!foregroundStarted) {
                stopSelf();
                return START_NOT_STICKY;
            }
            if (intent != null) {
                if (intent.hasExtra("position")) setPosition(intent.getLongExtra("position", position));
                if (intent.hasExtra("duration")) duration = intent.getLongExtra("duration", duration);
            }
            recordDiagnostic("seek", "position=" + position + " duration=" + duration);
            updatePlaybackState();
            updateTicker();
            return START_STICKY;
        }

        if (ACTION_LYRICS.equals(action)) {
            String payload = intent != null ? intent.getStringExtra("lyrics") : null;
            if (!foregroundStarted) {
                pendingLyrics = payload;
                stopSelf();
                return START_NOT_STICKY;
            }
            applyLyrics(payload);
            return START_STICKY;
        }

        if (intent != null) {
            if (intent.hasExtra("title")) title = intent.getStringExtra("title");
            if (intent.hasExtra("artist")) artist = intent.getStringExtra("artist");
            if (intent.hasExtra("duration")) duration = intent.getLongExtra("duration", duration);
            if (intent.hasExtra("artwork")) updateArtwork(intent.getStringExtra("artwork"));
            pauseOnNoisy = intent.getBooleanExtra("pauseOnNoisy", pauseOnNoisy);
            playing = intent.getBooleanExtra("playing", playing);
            long next = intent.getLongExtra("position", currentPosition());
            // Start/pause and explicit seeks may set any position; ordinary
            // updates must not rewind a playing timeline.
            if (ACTION_START.equals(action) || !playing || next >= currentPosition()) {
                setPosition(next);
            } else {
                String message = "ignore stale update " + next + " < " + currentPosition();
                Log.d("CeruLyrics", message);
                recordDiagnostic("progress", message);
            }
        }

        if (ACTION_TOGGLE.equals(action)) {
            emit(playing ? "pause" : "play");
        } else if (ACTION_PREVIOUS.equals(action)) {
            emit("previous");
        } else if (ACTION_NEXT.equals(action)) {
            emit("next");
        }

        if (ACTION_START.equals(action) || ACTION_UPDATE.equals(action)
                || ACTION_TOGGLE.equals(action) || ACTION_PREVIOUS.equals(action)
                || ACTION_NEXT.equals(action)) {
            startAsForeground();
            if (pendingLyrics != null) {
                String payload = pendingLyrics;
                pendingLyrics = null;
                applyLyrics(payload);
            }
            updateSession();
            updateWakeLock();
            updateTicker();
        }
        return START_STICKY;
    }

    private void setPosition(long value) {
        position = Math.max(0, value);
        if (duration > 0) position = Math.min(position, duration);
        positionBaseRealtime = SystemClock.elapsedRealtime();
    }

    private long currentPosition() {
        if (!playing) return position;
        long elapsed = Math.max(0, SystemClock.elapsedRealtime() - positionBaseRealtime);
        long value = position + elapsed;
        if (duration > 0) value = Math.min(value, duration);
        return value;
    }

    private void updateTicker() {
        mainHandler.removeCallbacks(progressTicker);
        mainHandler.removeCallbacks(lyricTicker);
        if (playing) {
            mainHandler.post(progressTicker);
            if (lyricsEnabled && !lyricLines.isEmpty()) mainHandler.post(lyricTicker);
        }
    }

    private PendingIntent contentIntent() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(
                this,
                1,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void startAsForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        foregroundStarted = true;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "音乐播放",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private PendingIntent serviceIntent(String action, int requestCode) {
        Intent intent = new Intent(this, MediaPlaybackService.class).setAction(action);
        return PendingIntent.getService(
                this,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Notification buildNotification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        builder.setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(title)
                .setContentText(artist)
                .setContentIntent(contentIntent())
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setOnlyAlertOnce(true)
                .setOngoing(playing)
                .setShowWhen(false)
                .addAction(
                        new Notification.Action.Builder(
                                Icon.createWithResource(this, R.drawable.ic_media_previous),
                                "上一首",
                                serviceIntent(ACTION_PREVIOUS, 11)
                        ).build()
                )
                .addAction(
                        new Notification.Action.Builder(
                                Icon.createWithResource(
                                        this,
                                        playing ? R.drawable.ic_media_pause : R.drawable.ic_media_play
                                ),
                                playing ? "暂停" : "播放",
                                serviceIntent(ACTION_TOGGLE, 12)
                        ).build()
                )
                .addAction(
                        new Notification.Action.Builder(
                                Icon.createWithResource(this, R.drawable.ic_media_next),
                                "下一首",
                                serviceIntent(ACTION_NEXT, 13)
                        ).build()
                )
                .setStyle(
                        new Notification.MediaStyle()
                                .setMediaSession(mediaSession.getSessionToken())
                                .setShowActionsInCompactView(0, 1, 2)
                );

        if (artwork != null) builder.setLargeIcon(artwork);
        if (duration > 0) {
            int progress = (int) Math.min(
                    1000L,
                    Math.round(currentPosition() * 1000.0 / (double) duration)
            );
            builder.setProgress(1000, Math.max(0, progress), false);
        } else {
            builder.setProgress(0, 0, false);
        }
        return builder.build();
    }

    private void refreshNotification() {
        if (!foregroundStarted) return;
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification());
    }

    /** Accepts the current lyric timeline from the WebView and republishes it. */
    private void applyLyrics(String raw) {
        lyricLines.clear();
        colorOsLyric = null;
        if (raw == null || raw.isEmpty()) {
            clearLyriconSong();
            updateMetadata();
            updatePlaybackState();
            refreshNotification();
            return;
        }
        try {
            JSONObject data = new JSONObject(raw);
            lyricsEnabled = data.optBoolean("enabled", true);
            lyricsTranslation = data.optBoolean("translation", true);
            String nextId = data.optString("id", "");
            if (!nextId.equals(mediaId)) lyricGeneration += 1;
            mediaId = nextId;
            title = data.optString("title", title);
            artist = data.optString("artist", artist);
            album = data.optString("album", "");
            long nextDuration = data.optLong("duration", duration);
            if (nextDuration > 0) duration = nextDuration;
            JSONArray lines = data.optJSONArray("lines");
            if (lines != null) {
                List<LyricLineData> parsed = new ArrayList<>(lines.length());
                for (int index = 0; index < lines.length(); index++) {
                    JSONObject line = lines.optJSONObject(index);
                    if (line == null) continue;
                    String text = line.optString("text", "").trim();
                    if (text.isEmpty()) continue;
                    long start = Math.max(0, line.optLong("start", 0));
                    long end = line.optLong("end", 0);
                    String translation = lyricsTranslation ? line.optString("translation", "") : "";
                    parsed.add(new LyricLineData(start, end, text, translation));
                }
                Collections.sort(parsed, (left, right) -> Long.compare(left.start, right.start));
                for (int index = 0; index < parsed.size(); index++) {
                    LyricLineData line = parsed.get(index);
                    long end = line.end;
                    // Missing/overlapping end times make several lines active at
                    // once; Lyricon then keeps showing one of them. Fall back to
                    // the next line's start, then to a 5 second window.
                    if (end <= line.start && index + 1 < parsed.size()) {
                        end = parsed.get(index + 1).start;
                    }
                    if (end <= line.start) end = line.start + 5000;
                    lyricLines.add(new LyricLineData(line.start, end, line.text, line.translation));
                }
                Log.d("CeruLyrics", "timeline " + lyricLines.size() + " lines, "
                        + (lyricLines.isEmpty() ? 0 : lyricLines.get(0).start) + ".."
                        + (lyricLines.isEmpty() ? 0 : lyricLines.get(lyricLines.size() - 1).end));
                recordDiagnostic("lyrics", "song=" + mediaId
                        + " lines=" + lyricLines.size()
                        + " first=" + (lyricLines.isEmpty() ? 0 : lyricLines.get(0).start)
                        + " last=" + (lyricLines.isEmpty() ? 0 : lyricLines.get(lyricLines.size() - 1).end)
                        + " enabled=" + lyricsEnabled);
            }
        } catch (Exception ignored) {
        }

        if (lyricsEnabled && !lyricLines.isEmpty()) {
            publishLyriconSong();
            colorOsLyric = buildColorOsLyric();
        } else {
            clearLyriconSong();
        }
        updateMetadata();
        updatePlaybackState();
        refreshNotification();
    }

    private void ensureLyricon() {
        if (lyriconProvider != null) return;
        try {
            ProviderInfo info = new ProviderInfo(
                    getPackageName(),
                    getPackageName(),
                    null,
                    null,
                    null
            );
            LyriconProvider provider = LyriconFactory.INSTANCE.createProvider(
                    this,
                    info,
                    null,
                    "com.android.systemui"
            );
            provider.setAutoSync(true);
            provider.register();
            lyriconProvider = provider;
        } catch (Throwable ignored) {
            lyriconProvider = null;
        }
    }

    private void publishLyriconSong() {
        if (!lyricsEnabled || lyricLines.isEmpty()) {
            clearLyriconSong();
            return;
        }
        ensureLyricon();
        if (lyriconProvider == null) return;
        try {
            List<RichLyricLine> lines = new ArrayList<>(lyricLines.size());
            for (LyricLineData line : lyricLines) {
                lines.add(new RichLyricLine(
                        line.start,
                        line.end,
                        Math.max(1, line.end - line.start),
                        false,
                        null,
                        line.text,
                        null,
                        null,
                        null,
                        line.translation.isEmpty() ? null : line.translation,
                        null,
                        null
                ));
            }
            Song song = new Song(
                    mediaId.isEmpty() ? title + "-" + artist : mediaId,
                    title,
                    artist,
                    duration,
                    null,
                    lines
            );
            RemotePlayer player = lyriconProvider.getPlayer();
            player.setDisplayTranslation(lyricsTranslation);
            player.setDisplayRoma(false);
            player.setSong(song);
            recordDiagnostic("lyricon", "setSong lines=" + lines.size()
                    + " id=" + song.getId() + " duration=" + song.getDuration());
            try {
                player.setPositionUpdateInterval((int) LYRICON_TICK_MS);
            } catch (Throwable ignored) {
            }
            // setSong 会重置中心服务的显示进度，必须紧接着把状态和位置补回去。
            lyriconPlaying = null;
            lyriconPosition = -1;
            pushLyriconState(true);
            mainHandler.removeCallbacks(lyricTicker);
            if (playing) mainHandler.post(lyricTicker);
        } catch (Throwable ignored) {
        }
    }

    private void clearLyriconSong() {
        lyriconPlaying = null;
        lyriconPosition = -1;
        lastLyriconDiagnosticAt = 0;
        recordDiagnostic("lyricon", "clear song");
        mainHandler.removeCallbacks(lyricTicker);
        if (lyriconProvider == null) return;
        try {
            lyriconProvider.getPlayer().setPlaybackState(false);
        } catch (Throwable ignored) {
        }
        try {
            lyriconProvider.getPlayer().setSong(null);
        } catch (Throwable ignored) {
        }
    }

    private void updateLyriconPlayback() {
        pushLyriconState(false);
    }

    /**
     * 同步歌词进度。顺序很关键：状态 → 带速度的 PlaybackState → 位置。
     * 反过来写的话，中心服务处理播放状态时会重置进度，刚写进去的位置就丢了，
     * 表现就是歌词一直卡在开头。
     */
    private void pushLyriconState(boolean force) {
        if (lyriconProvider == null || lyricLines.isEmpty()) return;
        try {
            RemotePlayer player = lyriconProvider.getPlayer();
            long position = currentPosition();
            long now = SystemClock.elapsedRealtime();
            if (force || now - lastLyriconDiagnosticAt >= 5000) {
                lastLyriconDiagnosticAt = now;
                recordDiagnostic("position", "pos=" + position + " playing=" + playing
                        + " lines=" + lyricLines.size());
            }
            boolean stateChanged = force || lyriconPlaying == null || lyriconPlaying != playing;
            if (stateChanged) {
                lyriconPlaying = playing;
                try {
                    // 手动位置模式：中心服务按 setPositionUpdateInterval 读取
                    // 下面写入的共享内存位置，不再根据 PlaybackState 自行外推。
                    player.setPlaybackState(playing);
                } catch (Throwable ignored) {
                }
            }
            // 位置必须是最后一个动作；跳变时先明确告诉中心服务这是一次 seek。
            if (lyriconPosition >= 0
                    && Math.abs(position - lyriconPosition) >= LYRICON_SEEK_JUMP_MS) {
                try {
                    player.seekTo(position);
                } catch (Throwable ignored) {
                }
            }
            player.setPosition(position);
            lyriconPosition = position;
        } catch (Throwable ignored) {
        }
    }

    private void destroyLyricon() {
        lyriconPlaying = null;
        lyriconPosition = -1;
        mainHandler.removeCallbacks(lyricTicker);
        if (lyriconProvider == null) return;
        try {
            lyriconProvider.getPlayer().setSong(null);
        } catch (Throwable ignored) {
        }
        try {
            lyriconProvider.destroy();
        } catch (Throwable ignored) {
        }
        lyriconProvider = null;
    }

    /** ColorOS / OPlus lock screen lyrics read this JSON from the media metadata. */
    private String buildColorOsLyric() {
        try {
            StringBuilder lrc = new StringBuilder();
            StringBuilder translation = new StringBuilder();
            for (LyricLineData line : lyricLines) {
                lrc.append('[').append(timestamp(line.start)).append(']')
                        .append(singleLine(line.text)).append('\n');
                if (!line.translation.isEmpty()) {
                    translation.append('[').append(timestamp(line.start)).append(']')
                            .append(singleLine(line.translation)).append('\n');
                }
            }
            JSONObject payload = new JSONObject()
                    .put("songName", title)
                    .put("artist", artist)
                    .put("songId", mediaId)
                    .put("lyricType", 0)
                    .put("lyric", lrc.toString())
                    .put("noLyric", lyricLines.isEmpty())
                    .put("provider", getPackageName())
                    .put("sessionGeneration", lyricGeneration);
            if (translation.length() > 0) {
                payload.put("translationLyric", translation.toString());
            }
            String value = payload.toString();
            return value.length() <= 128 * 1024 ? value : null;
        } catch (Exception error) {
            return null;
        }
    }

    private static String timestamp(long timeMs) {
        long minutes = timeMs / 60_000L;
        long seconds = (timeMs / 1_000L) % 60L;
        long millis = timeMs % 1_000L;
        return String.format(Locale.ROOT, "%02d:%02d.%03d", minutes, seconds, millis);
    }

    private static String singleLine(String text) {
        return text == null ? "" : text.replace('\r', ' ').replace('\n', ' ');
    }

    private void updateSession() {
        updateMetadata();
        updatePlaybackState();
    }

    private void updateMetadata() {
        if (mediaSession == null) return;
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                .putString(MediaMetadata.METADATA_KEY_MEDIA_ID, mediaId)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
        if (lyricsEnabled && colorOsLyric != null) {
            metadata.putString("lyricInfo", colorOsLyric);
        }
        if (artwork != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ART, artwork);
            // Some OEM lock screens use the display icon instead of the album art.
            metadata.putBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON, artwork);
        }
        mediaSession.setMetadata(metadata.build());
    }

    private void updatePlaybackState() {
        if (mediaSession == null) return;
        long actions = PlaybackState.ACTION_PLAY
                | PlaybackState.ACTION_PAUSE
                | PlaybackState.ACTION_PLAY_PAUSE
                | PlaybackState.ACTION_SKIP_TO_NEXT
                | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                | PlaybackState.ACTION_SEEK_TO
                | PlaybackState.ACTION_STOP;
        mediaSession.setPlaybackState(
                new PlaybackState.Builder()
                        .setActions(actions)
                        .setState(
                                playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                                currentPosition(),
                                playing ? 1.0f : 0.0f
                        )
                        .build()
        );
        updateLyriconPlayback();
    }

    /** Loads artwork in the background and refreshes metadata + notification when ready. */
    private void updateArtwork(String url) {
        String next = url == null ? "" : url.trim();
        if (next.equals(artworkUrl)) return;
        artworkUrl = next;
        if (next.isEmpty()) {
            artwork = null;
            refreshNotification();
            return;
        }
        Bitmap cached = ARTWORK_CACHE.get(next);
        if (cached != null) {
            artwork = cached;
            updateSession();
            refreshNotification();
            return;
        }
        artwork = null;
        refreshNotification();
        if (next.equals(loadingArtworkUrl)) return;
        loadingArtworkUrl = next;
        artworkExecutor.execute(() -> {
            Bitmap bitmap = null;
            try {
                bitmap = downloadArtwork(next);
            } catch (Exception ignored) {
            }
            if (bitmap == null) {
                if (next.equals(loadingArtworkUrl)) loadingArtworkUrl = "";
                return;
            }
            ARTWORK_CACHE.put(next, bitmap);
            final Bitmap loaded = bitmap;
            mainHandler.post(() -> {
                if (next.equals(loadingArtworkUrl)) loadingArtworkUrl = "";
                if (!next.equals(artworkUrl)) return;
                artwork = loaded;
                updateSession();
                refreshNotification();
            });
        });
    }

    private Bitmap downloadArtwork(String rawUrl) throws Exception {
        String currentUrl = rawUrl;
        for (int redirects = 0; redirects <= 5; redirects++) {
            URL url = new URL(currentUrl);
            NetworkSafety.validate(this, url);
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(15_000);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("User-Agent", ARTWORK_USER_AGENT);
            connection.setRequestProperty("Accept", "image/*,*/*;q=0.8");
            int status = connection.getResponseCode();
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.isEmpty() || redirects == 5) return null;
                currentUrl = new URL(url, location).toString();
                continue;
            }
            if (status < 200 || status >= 300) {
                connection.disconnect();
                return null;
            }
            byte[] data;
            try (InputStream input = connection.getInputStream();
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                int total = 0;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_ARTWORK_BYTES) return null;
                    output.write(buffer, 0, read);
                }
                data = output.toByteArray();
            } finally {
                connection.disconnect();
            }
            return decodeArtwork(data);
        }
        return null;
    }

    private static Bitmap decodeArtwork(byte[] data) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, bounds);
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
        int sample = 1;
        while (bounds.outWidth / sample > MAX_ARTWORK_SIZE
                || bounds.outHeight / sample > MAX_ARTWORK_SIZE) {
            sample *= 2;
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        return BitmapFactory.decodeByteArray(data, 0, data.length, options);
    }

    private void updateWakeLock() {
        if (wakeLock == null) return;
        if (playing) {
            if (!wakeLock.isHeld()) wakeLock.acquire();
        } else if (wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void stopPlayback() {
        playing = false;
        mainHandler.removeCallbacks(progressTicker);
        destroyLyricon();
        updateWakeLock();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        foregroundStarted = false;
        stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (!playing) {
            stopPlayback();
        }
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(progressTicker);
        destroyLyricon();
        artworkExecutor.shutdownNow();
        try {
            unregisterReceiver(noisyReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (mediaSession != null) {
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
