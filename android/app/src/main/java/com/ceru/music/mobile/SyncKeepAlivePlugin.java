package com.ceru.music.mobile;

import android.content.Intent;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Starts/stops the foreground shell used while WebDAV auto-sync is enabled. */
@CapacitorPlugin(name = "SyncKeepAlive")
public class SyncKeepAlivePlugin extends Plugin {
    private MainFrameGuard guard;

    @Override public void load() {
        guard = MainFrameGuard.forBridge(getBridge());
    }

    @PluginMethod public void initialize(PluginCall call) {
        guard.initialize(call);
    }

    private boolean require(PluginCall call) {
        try {
            guard.require(call);
            return true;
        } catch (Exception denied) {
            call.reject("后台同步保活仅允许应用主框架调用");
            return false;
        }
    }

    @PluginMethod public void start(PluginCall call) {
        if (!require(call)) return;
        try {
            ContextCompat.startForegroundService(
                    getContext(),
                    new Intent(getContext(), SyncKeepAliveService.class)
            );
            call.resolve();
        } catch (Exception error) {
            call.reject("无法启动后台同步保活服务");
        }
    }

    @PluginMethod public void stop(PluginCall call) {
        if (!require(call)) return;
        try {
            getContext().stopService(new Intent(getContext(), SyncKeepAliveService.class));
            call.resolve();
        } catch (Exception error) {
            call.reject("无法停止后台同步保活服务");
        }
    }

    @PluginMethod public void status(PluginCall call) {
        if (!require(call)) return;
        call.resolve(new JSObject().put("running", SyncKeepAliveService.isRunning()));
    }
}
