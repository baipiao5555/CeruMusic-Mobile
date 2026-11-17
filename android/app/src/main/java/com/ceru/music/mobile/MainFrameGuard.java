package com.ceru.music.mobile;

import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.PluginCall;
import com.getcapacitor.WebViewListener;
import org.json.JSONObject;
import java.lang.ref.WeakReference;
import java.net.URI;
import java.security.SecureRandom;
import java.util.Map;
import java.util.WeakHashMap;

/** Extra boundary for Capacitor's addJavascriptInterface fallback: never return this nonce to a caller. */
final class MainFrameGuard {
    static final String KEY = "__ceruPrivilegedMainFrame_v1";
    private static final Map<Bridge, MainFrameGuard> GUARDS = new WeakHashMap<>();
    private final WeakReference<Bridge> bridge;
    private final String capability;
    private volatile boolean installed;
    private MainFrameGuard(Bridge owner) {
        bridge = new WeakReference<>(owner);
        byte[] bytes = new byte[32]; new SecureRandom().nextBytes(bytes);
        StringBuilder value = new StringBuilder();
        for (byte item : bytes) value.append(String.format(java.util.Locale.ROOT, "%02x", item & 255));
        capability = value.toString();
        owner.getActivity().runOnUiThread(() -> owner.addWebViewListener(new WebViewListener() {
            @Override public void onPageStarted(WebView view) { installed = false; }
            @Override public void onPageLoaded(WebView view) { inject(null); }
            @Override public void onReceivedError(WebView view) { installed = false; }
        }));
    }
    static MainFrameGuard forBridge(Bridge owner) {
        synchronized (GUARDS) {
            MainFrameGuard guard = GUARDS.get(owner);
            if (guard == null) { guard = new MainFrameGuard(owner); GUARDS.put(owner, guard); }
            return guard;
        }
    }
    private static String origin(String raw) {
        try {
            URI value = new URI(raw);
            String scheme = value.getScheme();
            if (scheme == null || !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http")) || value.getHost() == null || value.getRawUserInfo() != null) return null;
            int port = value.getPort();
            if (port == (scheme.equalsIgnoreCase("https") ? 443 : 80)) port = -1;
            return new URI(scheme.toLowerCase(java.util.Locale.ROOT), null, value.getHost().toLowerCase(java.util.Locale.ROOT), port, null, null, null).toString();
        } catch (Exception ignored) { return null; }
    }
    private static boolean trusted(Bridge owner, String current) {
        String local = origin(owner.getLocalUrl()), server = origin(owner.getServerUrl());
        return current != null && (current.equals(local) || server != null && current.equals(server));
    }
    void initialize(PluginCall call) { inject(call); }
    private void inject(PluginCall call) {
        Bridge owner = bridge.get();
        if (owner == null) { if (call != null) call.reject("安全主框架不可用"); return; }
        owner.getActivity().runOnUiThread(() -> {
            String current = origin(owner.getWebView().getUrl());
            if (!trusted(owner, current)) { installed = false; if (call != null) call.reject("安全能力只允许受信任应用主框架"); return; }
            String script = "(function(){try{if(window.top!==window||location.origin!==" + JSONObject.quote(current) + ")return false;var k=" + JSONObject.quote(KEY) + ",v=" + JSONObject.quote(capability) + ";if(Object.prototype.hasOwnProperty.call(window,k))return window[k]===v;Object.defineProperty(window,k,{value:v,enumerable:false,writable:false,configurable:false});return true;}catch(e){return false;}})()";
            owner.getWebView().evaluateJavascript(script, result -> {
                installed = "true".equals(result) && trusted(owner, origin(owner.getWebView().getUrl()));
                if (call != null) { if (installed) call.resolve(); else call.reject("安全主框架能力注入失败"); }
            });
        });
    }
    void require(PluginCall call) {
        String supplied = call.getString("capability");
        if (!installed || supplied == null || supplied.length() != capability.length()) throw new SecurityException("Main-frame capability required");
        int mismatch = 0;
        for (int i = 0; i < capability.length(); i++) mismatch |= capability.charAt(i) ^ supplied.charAt(i);
        if (mismatch != 0) throw new SecurityException("Main-frame capability required");
    }
}
