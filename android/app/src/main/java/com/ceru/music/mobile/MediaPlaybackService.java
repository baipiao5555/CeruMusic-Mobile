package com.ceru.music.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.LruCache;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MediaPlaybackService extends Service {
    public static final String ACTION_START = "com.ceru.music.mobile.action.START";
    public static final String ACTION_UPDATE = "com.ceru.music.mobile.action.UPDATE";
    public static final String ACTION_PROGRESS = "com.ceru.music.mobile.action.PROGRESS";
    public static final String ACTION_STOP = "com.ceru.music.mobile.action.STOP";
    public static final String ACTION_TOGGLE = "com.ceru.music.mobile.action.TOGGLE";
    public static final String ACTION_PREVIOUS = "com.ceru.music.mobile.action.PREVIOUS";
    public static final String ACTION_NEXT = "com.ceru.music.mobile.action.NEXT";

    private static final String CHANNEL_ID = "ceru_music_playback";
    private static final int NOTIFICATION_ID = 2301;
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

    private static ActionListener actionListener;

    public static void setActionListener(ActionListener listener) {
        actionListener = listener;
    }

    private MediaSession mediaSession;
    private PowerManager.WakeLock wakeLock;
    private String title = "澜音";
    private String artist = "";
    private String artworkUrl = "";
    private Bitmap artwork;
    private String loadingArtworkUrl = "";
    private boolean playing = false;
    private boolean foregroundStarted = false;
    private long position = 0;
    private long positionBaseRealtime = 0;
    private long duration = 0;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final ExecutorService artworkExecutor = Executors.newSingleThreadExecutor();

    private final Runnable progressTicker = new Runnable() {
        @Override
        public void run() {
            if (!playing) return;
            updatePlaybackState();
            mainHandler.postDelayed(this, 1000);
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
                if (intent.hasExtra("position")) setPosition(intent.getLongExtra("position", position));
                if (intent.hasExtra("duration")) duration = intent.getLongExtra("duration", duration);
            }
            updatePlaybackState();
            return START_STICKY;
        }

        if (intent != null) {
            if (intent.hasExtra("title")) title = intent.getStringExtra("title");
            if (intent.hasExtra("artist")) artist = intent.getStringExtra("artist");
            if (intent.hasExtra("duration")) duration = intent.getLongExtra("duration", duration);
            if (intent.hasExtra("artwork")) updateArtwork(intent.getStringExtra("artwork"));
            playing = intent.getBooleanExtra("playing", playing);
            setPosition(intent.getLongExtra("position", currentPosition()));
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
        if (playing) mainHandler.post(progressTicker);
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

    private void updateSession() {
        updateMetadata();
        updatePlaybackState();
    }

    private void updateMetadata() {
        if (mediaSession == null) return;
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, duration);
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
        artworkExecutor.shutdownNow();
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
