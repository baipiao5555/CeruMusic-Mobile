package com.ceru.music.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import okhttp3.Call;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/** User-confirmed WebDAV origins only. This channel is NOT exposed to music plugin RPC. */
@CapacitorPlugin(name = "SyncHttp")
public class SyncHttpPlugin extends Plugin {
    private static final int MAX_BYTES = 5 * 1024 * 1024;
    private static final Set<String> METHODS = new HashSet<>(Arrays.asList("GET", "HEAD", "PUT", "DELETE", "OPTIONS", "PROPFIND", "MKCOL"));
    private static final Set<String> HEADERS = new HashSet<>(Arrays.asList("authorization", "content-type", "accept", "depth", "if-match", "if-none-match"));
    private static final String[] RESPONSE_HEADERS = {"etag", "dav", "allow", "content-type", "content-length", "last-modified"};
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build();
    private final Map<String, Permit> permits = new HashMap<>();
    private final Map<String, Set<Call>> active = new HashMap<>();
    private MainFrameGuard guard;
    @Override public void load() { guard = MainFrameGuard.forBridge(getBridge()); }
    @PluginMethod public void initialize(PluginCall call) { guard.initialize(call); }
    private static final class Permit {
        final HttpUrl origin; final String base;
        Permit(HttpUrl origin, String base) { this.origin = origin; this.base = base; }
    }
    private static String identity(String id) throws Exception {
        if (id == null || !id.matches("[A-Za-z0-9_-]{1,128}")) throw new Exception("Invalid connection"); return id;
    }
    private static boolean sameOrigin(HttpUrl a, HttpUrl b) { return a.scheme().equals(b.scheme()) && a.host().equals(b.host()) && a.port() == b.port(); }
    private static boolean unsafePath(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        return lower.contains("%2f") || lower.contains("%5c") || lower.contains("%2e") || lower.contains("%25") || path.contains("\\");
    }
    @PluginMethod public void authorize(PluginCall call) {
        try {
            guard.require(call);
            String id = identity(call.getString("connectionId")), base = call.getString("basePath");
            HttpUrl origin = HttpUrl.parse(call.getString("origin", ""));
            if (!Boolean.TRUE.equals(call.getBoolean("confirmed", false)) || origin == null || !origin.encodedPath().equals("/") || origin.query() != null || origin.fragment() != null || !origin.username().isEmpty() || !origin.password().isEmpty()) throw new Exception("Invalid approval");
            if (origin.scheme().equals("http") && !Boolean.TRUE.equals(call.getBoolean("allowInsecureHttp", false))) throw new Exception("HTTP needs explicit approval");
            if (base == null || !base.startsWith("/") || !base.endsWith("/") || base.length() > 2048 || unsafePath(base)) throw new Exception("Invalid directory");
            HttpUrl directory = origin.newBuilder().encodedPath(base).build();
            if (!directory.encodedPath().equals(base)) throw new Exception("Unnormalized directory");
            synchronized (permits) {
                Set<Call> calls = active.get(id); if (calls != null) for (Call request : calls) request.cancel();
                permits.put(id, new Permit(origin, base));
            }
            call.resolve();
        } catch (Exception error) { call.reject("同步地址授权无效，请重新确认专用地址与目录"); }
    }
    @PluginMethod public void revoke(PluginCall call) {
        try {
            guard.require(call);
            String id = identity(call.getString("connectionId"));
            synchronized (permits) { permits.remove(id); Set<Call> calls = active.remove(id); if (calls != null) for (Call request : calls) request.cancel(); }
            call.resolve();
        } catch (Exception error) { call.reject("同步连接撤销失败"); }
    }
    @PluginMethod public void request(PluginCall call) {
        try { guard.require(call); } catch (Exception denied) { call.reject("同步原生服务仅允许受信任主框架调用"); return; }
        executor.execute(() -> {
            String id = null; Call request = null;
            try {
                guard.require(call);
                id = identity(call.getString("connectionId")); Permit permit;
                synchronized (permits) { permit = permits.get(id); }
                HttpUrl url = HttpUrl.parse(call.getString("url", ""));
                if (permit == null || url == null || !sameOrigin(permit.origin, url) || !url.encodedPath().startsWith(permit.base) || unsafePath(url.encodedPath()) || url.query() != null || url.fragment() != null || !url.username().isEmpty() || !url.password().isEmpty()) throw new Exception("Outside approved scope");
                String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
                if (!METHODS.contains(method)) throw new Exception("Unsupported method");
                if (method.equals("DELETE") && !url.encodedPath().substring(permit.base.length()).matches("\\.ceru-test-[A-Za-z0-9_-]+\\.txt")) throw new Exception("Only probe cleanup is allowed");
                String body = call.getString("body");
                if (body != null && body.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new Exception("Request too large");
                JSObject headers = call.getObject("headers", new JSObject()); Request.Builder builder = new Request.Builder().url(url);
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    String lower = name.toLowerCase(Locale.ROOT), value = headers.optString(name, "");
                    if (!HEADERS.contains(lower) || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0 || value.length() > 32768) throw new Exception("Invalid header");
                    if (lower.equals("depth") && !value.equals("0") && !value.equals("1")) throw new Exception("Directory depth limit");
                    builder.header(name, value);
                }
                RequestBody payload = body == null ? null : RequestBody.create(body, MediaType.parse(headers.optString("Content-Type", headers.optString("content-type", "application/octet-stream"))));
                if (method.equals("PUT") && payload == null) payload = RequestBody.create("", MediaType.parse("application/octet-stream"));
                builder.method(method, payload);
                long timeout = Math.max(1000, Math.min(60000, call.getInt("timeoutMs", 30000)));
                request = client.newBuilder().connectTimeout(timeout, TimeUnit.MILLISECONDS).readTimeout(timeout, TimeUnit.MILLISECONDS).callTimeout(timeout, TimeUnit.MILLISECONDS).build().newCall(builder.build());
                synchronized (permits) {
                    if (permits.get(id) != permit) throw new Exception("Approval changed");
                    Set<Call> calls = active.get(id);
                    if (calls == null) { calls = new HashSet<>(); active.put(id, calls); }
                    calls.add(request);
                }
                try (Response response = request.execute()) {
                    JSObject result = new JSObject(); result.put("status", response.code()); JSObject responseHeaders = new JSObject();
                    for (String name : RESPONSE_HEADERS) { String value = response.header(name); if (value != null) responseHeaders.put(name, value); }
                    result.put("headers", responseHeaders);
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    if (response.body() != null && !method.equals("HEAD") && response.code() < 400) {
                        if (response.body().contentLength() > MAX_BYTES) throw new Exception("Response too large");
                        try (InputStream input = response.body().byteStream()) { byte[] bytes = new byte[8192]; int read; while ((read = input.read(bytes)) != -1) { if (out.size() + read > MAX_BYTES) throw new Exception("Response too large"); out.write(bytes, 0, read); } }
                    }
                    result.put("body", new String(out.toByteArray(), StandardCharsets.UTF_8)); guard.require(call); call.resolve(result);
                }
            } catch (Exception error) { call.reject("同步网络请求失败，请检查地址、网络与证书"); }
            finally { if (id != null && request != null) synchronized (permits) { Set<Call> calls = active.get(id); if (calls != null) { calls.remove(request); if (calls.isEmpty()) active.remove(id); } } }
        });
    }
    @Override protected void handleOnDestroy() {
        synchronized (permits) { for (Set<Call> calls : active.values()) for (Call call : calls) call.cancel(); active.clear(); permits.clear(); }
        executor.shutdownNow(); super.handleOnDestroy();
    }
}
