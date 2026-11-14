package com.ceru.music.mobile;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 本机音频缓存代理。
 *
 * WebView 里的 audio 播放的是 http://127.0.0.1:端口/cache?t=token&u=编码后的音频地址，
 * 第一次播放边播边落到 cacheDir/audio/<sha1>.bin，第二次起直接读本地文件，不再消耗流量。
 * 只监听回环地址，并要求一次性 token，局域网里的其它设备碰不到。
 */
public class AudioCacheServer {
    private static final int BUFFER = 64 * 1024;
    private static final String USER_AGENT =
            "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";

    private final File dir;
    private final long maxBytes;
    private final String token;
    private final android.content.Context context;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private ServerSocket socket;
    private volatile boolean running;

    AudioCacheServer(android.content.Context context, File cacheDir, long maxBytes) {
        this.context = context.getApplicationContext();
        this.dir = cacheDir;
        this.maxBytes = maxBytes;
        this.token = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        if (!dir.exists()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
    }

    synchronized int start() throws IOException {
        if (running && socket != null) return socket.getLocalPort();
        socket = new ServerSocket(0, 50, InetAddress.getByName("127.0.0.1"));
        running = true;
        Thread acceptor = new Thread(() -> {
            while (running) {
                try {
                    Socket client = socket.accept();
                    pool.execute(() -> handle(client));
                } catch (IOException error) {
                    break;
                }
            }
        }, "ceru-audio-cache");
        acceptor.setDaemon(true);
        acceptor.start();
        return socket.getLocalPort();
    }

    String token() {
        return token;
    }

    long size() {
        long total = 0;
        File[] files = dir.listFiles();
        if (files == null) return 0;
        for (File file : files) {
            if (file.isFile()) total += file.length();
        }
        return total;
    }

    void clear() {
        File[] files = dir.listFiles();
        if (files == null) return;
        for (File file : files) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private void handle(Socket client) {
        try (Socket socketRef = client) {
            socketRef.setSoTimeout(30_000);
            BufferedInputStream in = new BufferedInputStream(socketRef.getInputStream());
            OutputStream out = new BufferedOutputStream(socketRef.getOutputStream());

            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            boolean head = "HEAD".equalsIgnoreCase(parts[0]);
            String target = parts[1];

            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int colon = line.indexOf(':');
                if (colon > 0) {
                    headers.put(line.substring(0, colon).trim().toLowerCase(Locale.ROOT), line.substring(colon + 1).trim());
                }
            }

            String range = headers.get("range");
            int queryStart = target.indexOf('?');
            if (queryStart < 0) {
                writeError(out, 400, "bad request");
                return;
            }
            Map<String, String> query = parseQuery(target.substring(queryStart + 1));
            if (!token.equals(query.get("t"))) {
                writeError(out, 403, "forbidden");
                return;
            }
            String upstream = query.get("u");
            if (query.containsKey("id")) {
                serveLocal(out, query.get("id"), range, head);
                return;
            }
            if (upstream == null || upstream.isEmpty()) {
                writeError(out, 400, "missing url");
                return;
            }
            upstream = URLDecoder.decode(upstream, StandardCharsets.UTF_8.name());
            if (!upstream.startsWith("http://") && !upstream.startsWith("https://")) {
                writeError(out, 400, "unsupported url");
                return;
            }
            String ext = query.get("x");

            File cacheFile = new File(dir, sha1(upstream) + ".bin");
            if (cacheFile.isFile() && cacheFile.length() > 0) {
                serveFile(out, cacheFile, range, head, ext);
                touch(cacheFile);
                return;
            }
            // Chrome 播放音频时首个请求通常是 "Range: bytes=0-"，等同于要整首，可以边下边存。
            boolean fullRange = range == null || range.isEmpty() || range.replace(" ", "").matches("bytes=0+-[0-9]*");
            if (!fullRange) {
                // 中途 seek 的 Range 直接透传，避免把半截文件当成完整缓存
                proxy(out, upstream, range, head);
                return;
            }
            if (head) {
                proxy(out, upstream, null, true);
                return;
            }
            downloadAndServe(out, upstream, cacheFile, range != null && !range.isEmpty());
        } catch (Throwable ignored) {
            // 客户端提前关闭连接很正常，静默结束
            }
    }

    /**
     * 本机音乐：按 MediaStore id 打开 content:// 流并直出，支持 Range。
     * 不复制文件，也不进入音频缓存目录，播完即关。
     */
    private void serveLocal(OutputStream out, String id, String range, boolean head) throws IOException {
        if (id == null || id.isEmpty()) {
            writeError(out, 400, "missing id");
            return;
        }
        android.net.Uri uri;
        try {
            uri = com.ceru.music.mobile.LocalMediaPlugin.audioUri(id);
        } catch (NumberFormatException error) {
            writeError(out, 400, "bad id");
            return;
        }
        android.content.res.AssetFileDescriptor descriptor = null;
        java.io.FileInputStream stream = null;
        try {
            descriptor = context.getContentResolver().openAssetFileDescriptor(uri, "r");
            if (descriptor == null) {
                writeError(out, 404, "not found");
                return;
            }
            long total = descriptor.getLength();
            String type = context.getContentResolver().getType(uri);
            if (type == null || type.isEmpty()) type = "audio/mpeg";

            long from = 0;
            long to = total > 0 ? total - 1 : -1;
            boolean partial = false;
            if (range != null && range.startsWith("bytes=") && total > 0) {
                String spec = range.substring(6).split(",")[0].trim();
                int dash = spec.indexOf('-');
                if (dash >= 0) {
                    String startText = spec.substring(0, dash).trim();
                    String endText = spec.substring(dash + 1).trim();
                    if (!startText.isEmpty()) from = Long.parseLong(startText);
                    if (!endText.isEmpty()) to = Long.parseLong(endText);
                    if (to >= total) to = total - 1;
                    if (from < 0 || from > to) {
                        String header = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */"
                                + total + "\r\nConnection: close\r\n\r\n";
                        out.write(header.getBytes(StandardCharsets.UTF_8));
                        out.flush();
                        return;
                    }
                    partial = true;
                }
            }

            long length = total > 0 ? (to - from + 1) : -1;
            StringBuilder header = new StringBuilder();
            header.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
            header.append("Content-Type: ").append(type).append("\r\n");
            header.append("Accept-Ranges: bytes\r\n");
            if (total > 0) {
                if (partial) {
                    header.append("Content-Range: bytes ").append(from).append('-').append(to)
                            .append('/').append(total).append("\r\n");
                }
                header.append("Content-Length: ").append(length).append("\r\n");
            }
            header.append("Cache-Control: no-store\r\nConnection: close\r\n\r\n");
            out.write(header.toString().getBytes(StandardCharsets.UTF_8));
            if (head) {
                out.flush();
                return;
            }

            stream = descriptor.createInputStream();
            if (from > 0) {
                long skipped = 0;
                while (skipped < from) {
                    long step = stream.skip(from - skipped);
                    if (step <= 0) break;
                    skipped += step;
                }
            }
            byte[] buffer = new byte[BUFFER];
            long remaining = length;
            while (remaining != 0) {
                int want = remaining < 0 ? buffer.length : (int) Math.min(buffer.length, remaining);
                int read = stream.read(buffer, 0, want);
                if (read <= 0) break;
                out.write(buffer, 0, read);
                if (remaining > 0) remaining -= read;
            }
            out.flush();
        } catch (Throwable error) {
            try {
                writeError(out, 500, "local stream failed");
            } catch (IOException ignored) {
            }
        } finally {
            if (stream != null) {
                try {
                    stream.close();
                } catch (IOException ignored) {
                }
            }
            if (descriptor != null) {
                try {
                    descriptor.close();
                } catch (IOException ignored) {
                }
            }
        }
    }

    private void serveFile(OutputStream out, File file, String range, boolean head, String ext) throws IOException {
        long total = file.length();
        long start = 0;
        long end = total - 1;
        boolean partial = false;
        if (range != null && range.startsWith("bytes=")) {
            String spec = range.substring(6);
            int dash = spec.indexOf('-');
            if (dash >= 0) {
                try {
                    String from = spec.substring(0, dash).trim();
                    String to = spec.substring(dash + 1).trim();
                    if (!from.isEmpty()) start = Long.parseLong(from);
                    if (!to.isEmpty()) end = Math.min(Long.parseLong(to), total - 1);
                    partial = true;
                } catch (NumberFormatException error) {
                    start = 0;
                    end = total - 1;
                    partial = false;
                }
            }
        }
        if (start > end || start >= total) {
            String header = "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */" + total + "\r\nConnection: close\r\n\r\n";
            out.write(header.getBytes(StandardCharsets.UTF_8));
            out.flush();
            return;
        }
        long length = end - start + 1;
        StringBuilder response = new StringBuilder();
        response.append(partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        response.append("Content-Type: ").append(contentType(ext)).append("\r\n");
        response.append("Accept-Ranges: bytes\r\n");
        response.append("Cache-Control: no-store\r\n");
        response.append("Content-Length: ").append(length).append("\r\n");
        if (partial) {
            response.append("Content-Range: bytes ").append(start).append('-').append(end).append('/').append(total).append("\r\n");
        }
        response.append("Connection: close\r\n\r\n");
        out.write(response.toString().getBytes(StandardCharsets.UTF_8));
        out.flush();
        if (head) return;

        try (RandomAccessFile reader = new RandomAccessFile(file, "r")) {
            reader.seek(start);
            byte[] buffer = new byte[BUFFER];
            long remaining = length;
            while (remaining > 0) {
                int read = reader.read(buffer, 0, (int) Math.min(buffer.length, remaining));
                if (read < 0) break;
                out.write(buffer, 0, read);
                remaining -= read;
                if (remaining % (BUFFER * 4) == 0) out.flush();
            }
            out.flush();
        }
    }

    private void downloadAndServe(OutputStream out, String upstream, File cacheFile, boolean partial) throws IOException {
        HttpURLConnection connection = open(upstream, null, "GET");
        int code = connection.getResponseCode();
        if (code != 200 && code != 206) {
            writeError(out, 502, "upstream " + code);
            connection.disconnect();
            return;
        }
        long length = contentLength(connection);
        String type = connection.getContentType();
        StringBuilder response = new StringBuilder();
        boolean ranged = partial && length > 0;
        response.append(ranged ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        response.append("Content-Type: ").append(type == null ? "audio/mpeg" : type).append("\r\n");
        response.append("Accept-Ranges: bytes\r\n");
        response.append("Cache-Control: no-store\r\n");
        if (length > 0) response.append("Content-Length: ").append(length).append("\r\n");
        if (ranged) response.append("Content-Range: bytes 0-").append(length - 1).append('/').append(length).append("\r\n");
        response.append("Connection: close\r\n\r\n");
        out.write(response.toString().getBytes(StandardCharsets.UTF_8));
        out.flush();

        File part = new File(cacheFile.getAbsolutePath() + ".part");
        boolean complete = false;
        try (InputStream body = new BufferedInputStream(connection.getInputStream(), BUFFER);
             FileOutputStream sink = new FileOutputStream(part)) {
            byte[] buffer = new byte[BUFFER];
            long written = 0;
            int read;
            while ((read = body.read(buffer)) > 0) {
                out.write(buffer, 0, read);
                sink.write(buffer, 0, read);
                written += read;
                if (written % (BUFFER * 4) < BUFFER) out.flush();
            }
            out.flush();
            sink.flush();
            complete = length <= 0 || written >= length;
        } catch (IOException error) {
            // 用户拖动进度条会中断连接，半截文件不能留
            complete = false;
        } finally {
            connection.disconnect();
            if (complete) {
                //noinspection ResultOfMethodCallIgnored
                part.renameTo(cacheFile);
                evict();
            } else {
                //noinspection ResultOfMethodCallIgnored
                part.delete();
            }
        }
    }

    private void proxy(OutputStream out, String upstream, String range, boolean head) throws IOException {
        HttpURLConnection connection = open(upstream, range, head ? "HEAD" : "GET");
        int code = connection.getResponseCode();
        if (code != 200 && code != 206) {
            writeError(out, 502, "upstream " + code);
            connection.disconnect();
            return;
        }
        StringBuilder response = new StringBuilder();
        response.append(code == 206 ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n");
        String type = connection.getContentType();
        response.append("Content-Type: ").append(type == null ? "audio/mpeg" : type).append("\r\n");
        response.append("Accept-Ranges: bytes\r\n");
        String contentRange = connection.getHeaderField("Content-Range");
        if (contentRange != null) response.append("Content-Range: ").append(contentRange).append("\r\n");
        long length = contentLength(connection);
        if (length > 0) response.append("Content-Length: ").append(length).append("\r\n");
        response.append("Connection: close\r\n\r\n");
        out.write(response.toString().getBytes(StandardCharsets.UTF_8));
        out.flush();
        if (head) {
            connection.disconnect();
            return;
        }
        try (InputStream body = new BufferedInputStream(connection.getInputStream(), BUFFER)) {
            byte[] buffer = new byte[BUFFER];
            int read;
            while ((read = body.read(buffer)) > 0) {
                out.write(buffer, 0, read);
            }
            out.flush();
        } finally {
            connection.disconnect();
        }
    }

    private static long contentLength(HttpURLConnection connection) {
        // minSdk 23 上没有 getContentLengthLong()
        String raw = connection.getHeaderField("Content-Length");
        if (raw == null) return -1;
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException error) {
            return -1;
        }
    }

    private HttpURLConnection open(String url, String range, String method) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        connection.setRequestMethod(method);
        connection.setRequestProperty("User-Agent", USER_AGENT);
        connection.setRequestProperty("Accept", "*/*");
        if (range != null) connection.setRequestProperty("Range", range);
        return connection;
    }

    private void evict() {
        long total = size();
        if (total <= maxBytes) return;
        File[] files = dir.listFiles();
        if (files == null) return;
        Arrays.sort(files, new Comparator<File>() {
            @Override
            public int compare(File left, File right) {
                long a = left.lastModified();
                long b = right.lastModified();
                return a == b ? 0 : (a < b ? -1 : 1);
            }
        });
        for (File file : files) {
            if (total <= maxBytes) break;
            if (!file.isFile()) continue;
            long length = file.length();
            if (file.delete()) total -= length;
        }
    }

    private void touch(File file) {
        //noinspection ResultOfMethodCallIgnored
        file.setLastModified(System.currentTimeMillis());
    }

    private static String contentType(String ext) {
        if (ext == null) return "audio/mpeg";
        String value = ext.toLowerCase(Locale.ROOT);
        if (value.startsWith(".")) value = value.substring(1);
        if (value.equals("flac")) return "audio/flac";
        if (value.equals("m4a") || value.equals("mp4") || value.equals("aac")) return "audio/mp4";
        if (value.equals("ogg") || value.equals("opus")) return "audio/ogg";
        if (value.equals("wav")) return "audio/wav";
        return "audio/mpeg";
    }

    private static void writeError(OutputStream out, int code, String message) throws IOException {
        byte[] body = message.getBytes(StandardCharsets.UTF_8);
        String head = "HTTP/1.1 " + code + " Error\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: "
                + body.length + "\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder builder = new StringBuilder();
        int value;
        while ((value = in.read()) != -1) {
            if (value == '\n') break;
            if (value != '\r') builder.append((char) value);
            if (builder.length() > 8192) break;
        }
        if (value == -1 && builder.length() == 0) return null;
        return builder.toString();
    }

    private static Map<String, String> parseQuery(String query) {
        Map<String, String> result = new HashMap<>();
        for (String pair : query.split("&")) {
            int equals = pair.indexOf('=');
            if (equals <= 0) continue;
            result.put(pair.substring(0, equals), pair.substring(equals + 1));
        }
        return result;
    }

    static String sha1(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            byte[] bytes = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            for (byte value : bytes) builder.append(String.format(Locale.ROOT, "%02x", value));
            return builder.toString();
        } catch (Exception error) {
            return Integer.toHexString(input.hashCode());
        }
    }
}

