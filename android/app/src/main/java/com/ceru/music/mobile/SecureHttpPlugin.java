package com.ceru.music.mobile;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "SecureHttp")
public class SecureHttpPlugin extends Plugin {
    private static final int MAX_BODY_BYTES = 16 * 1024 * 1024;
    private static final int MAX_REDIRECTS = 5;
    private static final String BLOCKED_MESSAGE = "出于安全原因，不能访问本机、回环或局域网地址";

    private final ExecutorService executor = Executors.newCachedThreadPool();

    @PluginMethod
    public void request(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("请求地址为空");
            return;
        }
        String method = call.getString("method", "GET").toUpperCase(Locale.ROOT);
        String body = call.getString("body");
        JSObject headers = call.getObject("headers", new JSObject());
        long timeout = Math.max(1000, Math.min(60000, call.getLong("timeoutMs", 30000L)));
        executor.execute(() -> {
            try {
                JSObject response = perform(url, method, headers, body, timeout);
                call.resolve(response);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "网络请求失败" : error.getMessage());
            }
        });
    }

    private JSObject perform(
            String initialUrl,
            String initialMethod,
            JSObject headers,
            String body,
            long timeout
    ) throws Exception {
        String currentUrl = initialUrl;
        String method = initialMethod;
        String currentBody = body;
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            URL url = new URL(currentUrl);
            validateUrl(url);

            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout((int) timeout);
            connection.setReadTimeout((int) timeout);
            connection.setRequestMethod(method);
            applyHeaders(connection, headers);
            if (currentBody != null && !"GET".equals(method) && !"HEAD".equals(method)) {
                connection.setDoOutput(true);
                connection.getOutputStream().write(currentBody.getBytes(StandardCharsets.UTF_8));
            }

            int status = connection.getResponseCode();
            if (isRedirect(status)) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new Exception("重定向缺少目标地址");
                }
                if (redirects == MAX_REDIRECTS) {
                    throw new Exception("重定向次数过多");
                }
                URL next = new URL(url, location);
                boolean crossOrigin = !sameOrigin(url, next);
                if (crossOrigin) headers = stripSensitiveHeaders(headers);
                if (status == 303 || ((status == 301 || status == 302) && "POST".equals(method))) {
                    method = "GET";
                    currentBody = null;
                }
                currentUrl = next.toString();
                continue;
            }

            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = stream == null ? "" : readLimited(stream);

            JSObject response = new JSObject();
            response.put("status", status);
            response.put("body", text);
            JSObject responseHeaders = new JSObject();
            for (Map.Entry<String, List<String>> entry : connection.getHeaderFields().entrySet()) {
                if (entry.getKey() == null || entry.getValue() == null || entry.getValue().isEmpty()) continue;
                responseHeaders.put(entry.getKey().toLowerCase(Locale.ROOT), entry.getValue().get(0));
            }
            response.put("headers", responseHeaders);
            connection.disconnect();
            return response;
        }
        throw new Exception("重定向次数过多");
    }

    private static boolean isRedirect(int status) {
        return status == 301 || status == 302 || status == 303 || status == 307 || status == 308;
    }

    private static boolean sameOrigin(URL first, URL second) {
        return first.getProtocol().equalsIgnoreCase(second.getProtocol())
                && first.getHost().equalsIgnoreCase(second.getHost())
                && effectivePort(first) == effectivePort(second);
    }

    private static int effectivePort(URL url) {
        if (url.getPort() >= 0) return url.getPort();
        return "https".equalsIgnoreCase(url.getProtocol()) ? 443 : 80;
    }

    private static JSObject stripSensitiveHeaders(JSObject headers) throws Exception {
        JSObject filtered = new JSObject();
        java.util.Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String name = keys.next();
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.contains("authorization") || lower.contains("cookie")
                    || lower.contains("token") || lower.contains("key")) continue;
            filtered.put(name, headers.getString(name));
        }
        return filtered;
    }

    private static void applyHeaders(HttpURLConnection connection, JSObject headers) {
        java.util.Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String name = keys.next();
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.equals("host") || lower.equals("connection") || lower.equals("content-length")
                    || lower.equals("transfer-encoding") || lower.startsWith("proxy-")
                    || lower.equals("upgrade") || lower.equals("accept-encoding")) continue;
            String value = headers.getString(name);
            if (value == null || value.contains("\r") || value.contains("\n")) continue;
            connection.setRequestProperty(name, value);
        }
    }

    private void validateUrl(URL url) throws Exception {
        String scheme = url.getProtocol();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new Exception("只支持 HTTP/HTTPS 请求");
        }
        URI uri = url.toURI();
        if (uri.getUserInfo() != null) {
            throw new Exception("请求地址不能包含用户名或密码");
        }
        String host = url.getHost();
        if (host == null || host.isEmpty()) {
            throw new Exception("无效的请求地址");
        }
        InetAddress[] addresses = InetAddress.getAllByName(host);
        if (addresses.length == 0) {
            throw new Exception("无法解析服务器地址");
        }
        // VPN/代理客户端常用 198.18.0.0/15、100.64.0.0/10 或 IPv6 ULA
        // 作为 fake-IP 映射公网域名。此时解析结果不是真实目的地，按真实
        // 私网地址拦截会让所有插件链接都不可用。域名解析到透明代理网段时
        // 放行；IP 字面量仍按私网/保留地址严格拦截。
        boolean vpnActive = isVpnActive();
        boolean domainName = !isIpLiteral(host);
        for (InetAddress address : addresses) {
            if (isBlockedAddress(address)) {
                if (isVpnFakeAddress(address) && (vpnActive || domainName)) continue;
                throw new Exception(BLOCKED_MESSAGE);
            }
        }
    }

    private static boolean isIpLiteral(String host) {
        return host.indexOf(':') >= 0 || host.matches("\\d{1,3}(\\.\\d{1,3}){3}");
    }

    private boolean isVpnActive() {
        ConnectivityManager manager =
                (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        Network network = manager.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        return capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
    }

    private static boolean isVpnFakeAddress(InetAddress address) {
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int a = bytes[0] & 0xff;
            int b = bytes[1] & 0xff;
            return (a == 198 && (b == 18 || b == 19))
                    || (a == 100 && b >= 64 && b <= 127);
        }
        if (bytes.length == 16) {
            return ((bytes[0] & 0xfe) == 0xfc);
        }
        return false;
    }

    private static boolean isBlockedAddress(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress()
                || address.isLinkLocalAddress() || address.isSiteLocalAddress()
                || address.isMulticastAddress()) {
            return true;
        }
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int a = bytes[0] & 0xff;
            int b = bytes[1] & 0xff;
            if (a == 0 || a == 10 || a == 127 || a >= 224) return true;
            if (a == 169 && b == 254) return true;
            if (a == 172 && b >= 16 && b <= 31) return true;
            if (a == 192 && b == 168) return true;
            if (a == 100 && b >= 64 && b <= 127) return true;
            if (a == 192 && b == 0) return true;
            if (a == 198 && (b == 18 || b == 19)) return true;
            if (a == 198 && b == 51) return true;
            if (a == 203 && b == 0) return true;
        } else if (bytes.length == 16) {
            int first = bytes[0] & 0xff;
            if ((first & 0xfe) == 0xfc) return true;
            if (first == 0xfe && (bytes[1] & 0xc0) == 0x80) return true;
            boolean mapped = true;
            for (int i = 0; i < 10; i++) {
                if (bytes[i] != 0) {
                    mapped = false;
                    break;
                }
            }
            if (mapped && bytes[10] == (byte) 0xff && bytes[11] == (byte) 0xff) {
                int a = bytes[12] & 0xff;
                int b = bytes[13] & 0xff;
                return a == 0 || a == 10 || a == 127 || a >= 224
                        || (a == 169 && b == 254)
                        || (a == 172 && b >= 16 && b <= 31)
                        || (a == 192 && b == 168)
                        || (a == 100 && b >= 64 && b <= 127);
            }
        }
        return false;
    }

    private static String readLimited(InputStream stream) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            int total = 0;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BODY_BYTES) throw new Exception("响应内容过大");
                output.write(buffer, 0, read);
            }
            return output.toString(StandardCharsets.UTF_8.name());
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
