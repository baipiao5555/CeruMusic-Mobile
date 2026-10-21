package com.ceru.music.mobile;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.net.URI;

/** Opens web pages, installs downloaded APKs and posts update notifications. */
@CapacitorPlugin(name = "External")
public class ExternalPlugin extends Plugin {
    private static final String UPDATE_CHANNEL = "ceru-updates";
    private static final int UPDATE_NOTIFICATION_ID = 2001;
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("链接为空");
            return;
        }
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
                call.reject("只支持 HTTP/HTTPS 链接");
                return;
            }
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法打开浏览器" : error.getMessage());
        }
    }

    @PluginMethod
    public void installApk(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.isEmpty()) {
            call.reject("安装包文件名不能为空");
            return;
        }
        try {
            File dir = new File(getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC), "");
            File file = new File(dir, fileName);
            String root = dir.getCanonicalPath() + File.separator;
            if (!file.getCanonicalPath().startsWith(root)) {
                call.reject("安装包不在下载目录内");
                return;
            }
            if (!file.exists()) {
                call.reject("安装包不存在，请重新下载");
                return;
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                Intent settings = new Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName())
                );
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
                JSObject result = new JSObject();
                result.put("needsPermission", true);
                call.resolve(result);
                return;
            }
            Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + ".fileprovider",
                    file
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("started", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "无法调起安装器" : error.getMessage());
        }
    }

    @PluginMethod
    public void notifyUpdate(PluginCall call) {
        String title = call.getString("title", "发现新版本");
        String body = call.getString("body", "");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            call.resolve();
            return;
        }
        NotificationManager manager =
                (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            call.reject("通知服务不可用");
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = manager.getNotificationChannel(UPDATE_CHANNEL);
            if (channel == null) {
                channel = new NotificationChannel(
                        UPDATE_CHANNEL,
                        "应用更新",
                        NotificationManager.IMPORTANCE_DEFAULT
                );
                channel.setDescription("发现新版本时的提醒");
                manager.createNotificationChannel(channel);
            }
        }
        Intent intent = new Intent(getContext(), MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pending = PendingIntent.getActivity(getContext(), 0, intent, flags);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(getContext(), UPDATE_CHANNEL)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        manager.notify(UPDATE_NOTIFICATION_ID, builder.build());
        call.resolve();
    }
}
