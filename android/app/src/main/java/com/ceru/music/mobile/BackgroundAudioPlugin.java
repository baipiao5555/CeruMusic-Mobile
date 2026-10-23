package com.ceru.music.mobile;

import android.content.Context;
import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundAudio")
public class BackgroundAudioPlugin extends Plugin {
    @Override
    public void load() {
        MediaPlaybackService.setActionListener(action -> {
            JSObject payload = new JSObject();
            payload.put("action", action);
            notifyListeners("mediaAction", payload);
        });
    }

    @PluginMethod
    public void start(PluginCall call) {
        dispatch(call, MediaPlaybackService.ACTION_START, true);
    }

    @PluginMethod
    public void update(PluginCall call) {
        dispatch(call, MediaPlaybackService.ACTION_UPDATE, false);
    }

    @PluginMethod
    public void lyrics(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, MediaPlaybackService.class)
                .setAction(MediaPlaybackService.ACTION_LYRICS);
        intent.putExtra("lyrics", call.getString("payload", ""));
        context.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void progress(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, MediaPlaybackService.class)
                .setAction(MediaPlaybackService.ACTION_PROGRESS);
        intent.putExtra("position", call.getLong("position", 0L));
        intent.putExtra("duration", call.getLong("duration", 0L));
        context.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, MediaPlaybackService.class)
                .setAction(MediaPlaybackService.ACTION_SEEK);
        intent.putExtra("position", call.getLong("position", 0L));
        intent.putExtra("duration", call.getLong("duration", 0L));
        context.startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void diagnostics(PluginCall call) {
        JSArray entries = new JSArray();
        for (String entry : MediaPlaybackService.diagnosticsSnapshot()) {
            entries.put(entry);
        }
        JSObject result = new JSObject();
        result.put("entries", entries);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        Intent intent = new Intent(context, MediaPlaybackService.class)
                .setAction(MediaPlaybackService.ACTION_STOP);
        context.startService(intent);
        call.resolve();
    }

    private void dispatch(PluginCall call, String action, boolean foreground) {
        Context context = getContext();
        Intent intent = new Intent(context, MediaPlaybackService.class).setAction(action);
        intent.putExtra("title", call.getString("title", "澜音"));
        intent.putExtra("artist", call.getString("artist", ""));
        intent.putExtra("artwork", call.getString("artwork", ""));
        intent.putExtra("pauseOnNoisy", call.getBoolean("pauseOnNoisy", true));
        intent.putExtra("playing", call.getBoolean("playing", false));
        intent.putExtra("position", call.getLong("position", 0L));
        intent.putExtra("duration", call.getLong("duration", 0L));
        if (foreground) {
            ContextCompat.startForegroundService(context, intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        MediaPlaybackService.setActionListener(null);
        super.handleOnDestroy();
    }
}
