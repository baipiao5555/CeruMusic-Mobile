package com.ceru.music.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

public class MediaPlaybackService extends Service {
    public static final String ACTION_START = "com.ceru.music.mobile.action.START";
    public static final String ACTION_UPDATE = "com.ceru.music.mobile.action.UPDATE";
    public static final String ACTION_STOP = "com.ceru.music.mobile.action.STOP";
    public static final String ACTION_TOGGLE = "com.ceru.music.mobile.action.TOGGLE";
    public static final String ACTION_PREVIOUS = "com.ceru.music.mobile.action.PREVIOUS";
    public static final String ACTION_NEXT = "com.ceru.music.mobile.action.NEXT";

    private static final String CHANNEL_ID = "ceru_music_playback";
    private static final int NOTIFICATION_ID = 2301;

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
    private boolean playing = false;
    private long position = 0;
    private long duration = 0;

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

        if (intent != null) {
            if (intent.hasExtra("title")) title = intent.getStringExtra("title");
            if (intent.hasExtra("artist")) artist = intent.getStringExtra("artist");
            playing = intent.getBooleanExtra("playing", playing);
            position = intent.getLongExtra("position", position);
            duration = intent.getLongExtra("duration", duration);
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
        }
        return START_STICKY;
    }

    private void startAsForeground() {
        Notification notification = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
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
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
                this,
                1,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        builder.setSmallIcon(R.drawable.ic_stat_music)
                .setContentTitle(title)
                .setContentText(artist)
                .setContentIntent(contentIntent)
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
        return builder.build();
    }

    private void updateSession() {
        if (mediaSession == null) return;
        mediaSession.setMetadata(
                new MediaMetadata.Builder()
                        .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                        .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                        .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
                        .build()
        );
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
                        .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, 1.0f)
                        .build()
        );
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
        updateWakeLock();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
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
