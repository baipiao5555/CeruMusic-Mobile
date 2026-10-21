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
import android.os.Environment;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.net.URL;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Streams an audio file to the app's external Music directory so downloads do
 * not have to be buffered in the WebView and can report real progress.
 * Every hop is validated against the same SSRF rules as SecureHttpPlugin.
 */
@CapacitorPlugin(name = "Downloader")
public class DownloaderPlugin extends Plugin {
    private static final int MAX_REDIRECTS = 5;
    private static final long PROGRESS_INTERVAL_MS = 250L;
    private static final String BLOCKED_MESSAGE = "出于安全原因，不能访问本机、回环或局域网地址";

    private final ExecutorService executor = Executors.newFixedThreadPool(3);
    private final Map<String, Job> jobs = new ConcurrentHashMap<>();

    private static final class Job {
        volatile boolean cancelled;
    }

    @PluginMethod
    public void download(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        String fileName = call.getString("fileName", "audio.mp3");
        JSObject headers = call.getObject("headers", new JSObject());
        if (id == null || id.isEmpty()) {
            call.reject("下载任务缺少标识");
            return;
        }
        if (url == null || url.isEmpty()) {
            call.reject("下载地址为空");
            return;
        }
        Job job = new Job();
        jobs.put(id, job);
        final String safeName = sanitizeFileName(fileName);
        executor.execute(() -> {
            try {
                File target = uniqueFile(safeName);
                long size = perform(id, url, headers, target, job);
                JSObject result = new JSObject();
                result.put("id", id);
                result.put("path", target.getAbsolutePath());
                result.put("fileName", target.getName());
                result.put("size", size);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(messageOf(error));
            } finally {
                jobs.remove(id);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        Job job = id == null ? null : jobs.get(id);
        if (job != null) job.cancelled = true;
        call.resolve();
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String fileName = call.getString("fileName");
        if (fileName == null || fileName.isEmpty()) {
            call.reject("文件名不能为空");
            return;
        }
        try {
            File dir = musicDir();
            File target = new File(dir, fileName);
            String root = dir.getCanonicalPath() + File.separator;
            if (!target.getCanonicalPath().startsWith(root)) {
                call.reject("文件不在下载目录内");
                return;
            }
            if (target.exists() && !target.delete()) {
                call.reject("删除文件失败");
                return;
            }
            call.resolve();
        } catch (Exception error) {
            call.reject(messageOf(error));
        }
    }

    private long perform(String id, String initialUrl, JSObject initialHeaders, File target, Job job)
            throws Exception {
        String currentUrl = initialUrl;
        JSObject headers = initialHeaders;
        for (int redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
            if (job.cancelled) throw new Exception("已取消");
            URL url = new URL(currentUrl);
            validateUrl(url);

            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(60_000);
            connection.setRequestMethod("GET");
            applyHeaders(connection, headers);

            int status = connection.getResponseCode();
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null || location.isEmpty()) {
                    throw new Exception("重定向缺少目标地址");
                }
                if (redirects == MAX_REDIRECTS) throw new Exception("重定向次数过多");
                URL next = new URL(url, location);
                if (!sameOrigin(url, next)) headers = stripSensitiveHeaders(headers);
                currentUrl = next.toString();
                continue;
            }
            if (status < 200 || status >= 300) {
                connection.disconnect();
                throw new Exception("下载失败: HTTP " + status);
            }

            long total = connection.getContentLengthLong();
            long received = 0;
            long lastSent = 0L;
            byte[] buffer = new byte[16 * 1024];
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(target)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    if (job.cancelled) throw new Exception("已取消");
                    output.write(buffer, 0, read);
                    received += read;
                    long now = System.currentTimeMillis();
                    if (now - lastSent >= PROGRESS_INTERVAL_MS) {
                        lastSent = now;
                        emitProgress(id, received, total);
                    }
                }
            } finally {
                connection.disconnect();
            }
            emitProgress(id, received, total);
            if (received == 0) throw new Exception("下载内容为空");
            return received;
        }
        throw new Exception("重定向次数过多");
    }

    private void emitProgress(String id, long received, long total) {
        JSObject event = new JSObject();
        event.put("id", id);
        event.put("received", received);
        event.put("total", total);
        notifyListeners("progress", event);
    }

    private File musicDir() {
        File dir = getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC);
        if (dir == null) dir = new File(getContext().getFilesDir(), "Music");
        if (!dir.exists() && !dir.mkdirs()) {
            dir = new File(getContext().getFilesDir(), "Music");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        return dir;
    }

    private File uniqueFile(String fileName) {
        File dir = musicDir();
        File candidate = new File(dir, fileName);
        if (!candidate.exists()) return candidate;
        int dot = fileName.lastIndexOf('.');
        String base = dot > 0 ? fileName.substring(0, dot) : fileName;
        String ext = dot > 0 ? fileName.substring(dot) : "";
        for (int index = 1; index < 1000; index++) {
            candidate = new File(dir, base + " (" + index + ")" + ext);
            if (!candidate.exists()) return candidate;
        }
        return new File(dir, System.currentTimeMillis() + ext);
    }

    private static String sanitizeFileName(String value) {
        String name = value == null ? "" : value.trim();
        name = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        name = name.replaceAll("^[.\\s]+", "").replaceAll("[.\\s]+$", "");
        if (name.isEmpty()) name = "audio";
        if (name.length() > 120) {
            int dot = name.lastIndexOf('.');
            String ext = dot > 0 && name.length() - dot <= 6 ? name.substring(dot) : "";
            name = name.substring(0, 120 - ext.length()) + ext;
        }
        if (!name.contains(".")) name = name + ".mp3";
        return name;
    }

    private static String messageOf(Exception error) {
        return error.getMessage() == null ? "下载失败" : error.getMessage();
    }

    private void validateUrl(URL url) throws Exception {
        String scheme = url.getProtocol();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) {
            throw new Exception("只支持 HTTP/HTTPS 下载");
        }
        URI uri = url.toURI();
        if (uri.getUserInfo() != null) throw new Exception("下载地址不能包含用户名或密码");
        String host = url.getHost();
        if (host == null || host.isEmpty()) throw new Exception("无效的下载地址");
        InetAddress[] addresses = InetAddress.getAllByName(host);
        if (addresses.length == 0) throw new Exception("无法解析服务器地址");
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
            return (a == 198 && (b == 18 || b == 19)) || (a == 100 && b >= 64 && b <= 127);
        }
        if (bytes.length == 16) return (bytes[0] & 0xfe) == 0xfc;
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
        Iterator<String> keys = headers.keys();
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
        Iterator<String> keys = headers.keys();
        while (keys.hasNext()) {
            String name = keys.next();
            String lower = name.toLowerCase(Locale.ROOT);
            if (lower.equals("host") || lower.equals("connection") || lower.equals("content-length")
                    || lower.equals("transfer-encoding") || lower.startsWith("proxy-")
                    || lower.equals("upgrade") || lower.equals("accept-encoding")
                    || lower.equals("range")) continue;
            String value = headers.getString(name);
            if (value == null || value.contains("\r") || value.contains("\n")) continue;
            connection.setRequestProperty(name, value);
        }
    }

    @Override
    protected void handleOnDestroy() {
        for (Job job : jobs.values()) job.cancelled = true;
        executor.shutdownNow();
        super.handleOnDestroy();
    }
}
