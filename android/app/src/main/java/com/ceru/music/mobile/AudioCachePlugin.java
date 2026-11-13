package com.ceru.music.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * 播放缓存：把 &lt;audio&gt; 的远程地址换成本机代理地址，边播边落盘，重听直接读本地。
 */
@CapacitorPlugin(name = "AudioCache")
public class AudioCachePlugin extends Plugin {
    /** 缓存上限 512MB，超出按最久未用淘汰。 */
    private static final long MAX_BYTES = 512L * 1024 * 1024;

    private AudioCacheServer server;

    private AudioCacheServer server() {
        if (server == null) {
            server = new AudioCacheServer(new File(getContext().getCacheDir(), "audio"), MAX_BYTES);
        }
        return server;
    }

    @PluginMethod
    public void start(PluginCall call) {
        try {
            AudioCacheServer instance = server();
            int port = instance.start();
            JSObject result = new JSObject();
            result.put("port", port);
            result.put("token", instance.token());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("缓存服务启动失败: " + error.getMessage());
        }
    }

    @PluginMethod
    public void size(PluginCall call) {
        JSObject result = new JSObject();
        result.put("bytes", server().size());
        call.resolve(result);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        server().clear();
        JSObject result = new JSObject();
        result.put("bytes", 0);
        call.resolve(result);
    }
}
