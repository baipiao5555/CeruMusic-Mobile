package com.ceru.music.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Keeps the app process alive while WebDAV auto-sync is enabled.
 * It is deliberately only a keep-alive shell; the actual sync still runs in the
 * app's trusted main-frame code. It is not a WorkManager periodic job.
 */
public class SyncKeepAliveService extends Service {
    private static final String CHANNEL_ID = "ceru-webdav-sync";
    private static final int NOTIFICATION_ID = 24113;
    private static volatile boolean running;

    public static boolean isRunning() {
        return running;
    }

    @Override public void onCreate() {
        super.onCreate();
        running = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "WebDAV 自动同步",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("保持 WebDAV 自动同步进程运行");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    private Notification notification() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(this, 0, launch, flags);
        NotificationCompat.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new NotificationCompat.Builder(this, CHANNEL_ID)
                : new NotificationCompat.Builder(this);
        return builder
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("WebDAV 自动同步已启用")
                .setContentText("保持应用进程；实际同步仍受系统后台策略与网络状态影响")
                .setContentIntent(pending)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        startForeground(NOTIFICATION_ID, notification());
        return START_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
