package com.ceru.music.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import java.util.concurrent.atomic.AtomicBoolean;

public class MainActivity extends BridgeActivity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final long RESUME_HEALTH_CHECK_DELAY_MS = 5000;
    private static final long RESUME_HEALTH_CHECK_INTERVAL_MS = 30000;
    private boolean recoveringWebView;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private Runnable webViewHealthCheck;
    private long lastWebViewHealthCheckAt;
    private boolean foreground;
    private int resumeGeneration;

    @SuppressWarnings("deprecation")
    @Override
    public void finish() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            overrideActivityTransition(OVERRIDE_TRANSITION_CLOSE, 0, R.anim.app_exit);
            super.finish();
            return;
        }
        super.finish();
        overridePendingTransition(0, R.anim.app_exit);
    }

    @Override
    public void onResume() {
        super.onResume();
        foreground = true;
        resumeGeneration++;
        WebView view = getBridge() != null ? getBridge().getWebView() : null;
        if (view != null) {
            view.requestLayout();
            view.invalidate();
        }
        scheduleWebViewHealthCheck();
    }

    @Override
    public void onPause() {
        foreground = false;
        resumeGeneration++;
        if (webViewHealthCheck != null) {
            mainHandler.removeCallbacks(webViewHealthCheck);
            webViewHealthCheck = null;
            lastWebViewHealthCheckAt = 0;
        }
        super.onPause();
    }

    private void scheduleWebViewHealthCheck() {
        if (recoveringWebView) return;
        long now = SystemClock.elapsedRealtime();
        if (lastWebViewHealthCheckAt != 0 && now - lastWebViewHealthCheckAt < RESUME_HEALTH_CHECK_INTERVAL_MS) return;
        lastWebViewHealthCheckAt = now;
        WebView view = getBridge() != null ? getBridge().getWebView() : null;
        if (view == null) return;
        if (webViewHealthCheck != null) mainHandler.removeCallbacks(webViewHealthCheck);
        webViewHealthCheck = () -> checkWebViewHealth(view);
        mainHandler.postDelayed(webViewHealthCheck, RESUME_HEALTH_CHECK_DELAY_MS);
    }

    private void checkWebViewHealth(WebView view) {
        if (!foreground || recoveringWebView || isFinishing() || isDestroyed() || !view.isAttachedToWindow()) return;
        final int generation = resumeGeneration;
        String script = "(function(){var a=document.querySelector('#app');if(!a||!a.children.length)return false;return Array.from(a.querySelectorAll('.screen')).some(function(s){var r=s.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(s).visibility!=='hidden';});})()";
        AtomicBoolean answered = new AtomicBoolean(false);
        view.evaluateJavascript(script, result -> {
            if (!foreground || generation != resumeGeneration || recoveringWebView || isFinishing() || isDestroyed()) return;
            answered.set(true);
            if (!"true".equals(result)) {
                Log.w("CeruMusic", "WebView resume health check found an empty UI; reloading");
                view.reload();
            }
        });
        mainHandler.postDelayed(() -> {
            if (!foreground || generation != resumeGeneration || recoveringWebView || isFinishing() || isDestroyed() || !view.isAttachedToWindow()) return;
            if (answered.get()) return;
            Log.w("CeruMusic", "WebView resume health check timed out; rebuilding the activity");
            recoverWebView(view);
        }, 3000);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // Keep the latest callback across an Activity/WebView recreation.
        if (intent != null) setIntent(intent);
        super.onNewIntent(intent);
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundAudioPlugin.class);
        registerPlugin(SecureHttpPlugin.class);
        registerPlugin(SystemBarsPlugin.class);
        registerPlugin(DownloaderPlugin.class);
        registerPlugin(ExternalPlugin.class);
        registerPlugin(AudioCachePlugin.class);
        registerPlugin(LocalMediaPlugin.class);
        registerPlugin(MusicFoldersPlugin.class);
        registerPlugin(SecretStorePlugin.class);
        registerPlugin(SyncHttpPlugin.class);
        registerPlugin(SyncKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);

        // 本机缓存代理走 http://127.0.0.1，允许页面（https://localhost）加载它
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().getSettings().setMixedContentMode(
                    android.webkit.WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    Log.w("CeruMusic", "WebView renderer exited; rebuilding the activity");
                    recoverWebView(view);
                    return true;
                }
            });
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                        this,
                        new String[] { Manifest.permission.POST_NOTIFICATIONS },
                        NOTIFICATION_PERMISSION_REQUEST
                );
            }
        }
    }

    /** A dead renderer cannot be reused; keeping its WebView leaves a permanent blank screen. */
    private void recoverWebView(WebView view) {
        if (recoveringWebView || isFinishing() || isDestroyed()) return;
        recoveringWebView = true;
        if (webViewHealthCheck != null) {
            mainHandler.removeCallbacks(webViewHealthCheck);
            webViewHealthCheck = null;
        }
        if (view.getParent() instanceof ViewGroup) {
            ((ViewGroup) view.getParent()).removeView(view);
        }
        view.destroy();
        recreate();
    }

    @Override
    public void onDestroy() {
        foreground = false;
        resumeGeneration++;
        if (webViewHealthCheck != null) {
            mainHandler.removeCallbacks(webViewHealthCheck);
            webViewHealthCheck = null;
        }
        super.onDestroy();
    }
}
