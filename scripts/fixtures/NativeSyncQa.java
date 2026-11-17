import okhttp3.*;
import com.sun.net.httpserver.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.*;
import java.net.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Anonymous JVM primitive/library checks. This does NOT emulate AndroidKeyStore. */
public class NativeSyncQa {
    static int checks;
    static void check(String label, boolean result) { if (!result) throw new AssertionError(label); checks++; System.out.println("PASS " + label); }
    static Cipher encrypt(SecretKey key, String aad) throws Exception { Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key); cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8)); return cipher; }
    static byte[] decrypt(SecretKey key, byte[] iv, byte[] data, String aad) throws Exception { Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, iv)); cipher.updateAAD(aad.getBytes(StandardCharsets.UTF_8)); return cipher.doFinal(data); }
    public static void main(String[] args) throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES"); generator.init(256); SecretKey key = generator.generateKey(); String plain = "anonymous-credential-test", aad = "namespaceA\0token";
        Cipher first = encrypt(key, aad), second = encrypt(key, aad); byte[] encrypted = first.doFinal(plain.getBytes(StandardCharsets.UTF_8)); second.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        check("AES-GCM random12byte IV", first.getIV().length == 12 && !Arrays.equals(first.getIV(), second.getIV()));
        check("AES-GCM actual roundtrip", plain.equals(new String(decrypt(key, first.getIV(), encrypted, aad), StandardCharsets.UTF_8)));
        check("ciphertext record contains no plaintext", !Base64.getEncoder().encodeToString(encrypted).contains(plain));
        for (String changed : new String[]{"namespaceB\0token", "namespaceA\0other"}) { boolean rejected = false; try { decrypt(key, first.getIV(), encrypted, changed); } catch (AEADBadTagException expected) { rejected = true; } check("namespace/key AAD substitution rejected", rejected); }
        byte[] tampered = encrypted.clone(); tampered[0] ^= 1; boolean rejected = false; try { decrypt(key, first.getIV(), tampered, aad); } catch (AEADBadTagException expected) { rejected = true; } check("ciphertext tamper rejected", rejected);
        AtomicInteger requests = new AtomicInteger(); HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> { requests.incrementAndGet(); int code = exchange.getRequestMethod().equals("PROPFIND") ? 207 : 200; exchange.sendResponseHeaders(code, -1); exchange.close(); }); server.start();
        OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).build();
        try { for (String method : new String[]{"GET", "HEAD", "PUT", "DELETE", "OPTIONS", "PROPFIND", "MKCOL"}) {
            RequestBody body = method.equals("PUT") || method.equals("PROPFIND") ? RequestBody.create("anonymous", MediaType.parse("text/plain")) : null;
            try (Response response = client.newCall(new Request.Builder().url("http://127.0.0.1:" + server.getAddress().getPort() + "/probe").method(method, body).build()).execute()) { check("actual OkHttp custom method " + method, response.code() == (method.equals("PROPFIND") ? 207 : 200)); }
        } check("all7 methods issued actual HTTP", requests.get() == 7); } finally { server.stop(0); }
        Path p12 = Paths.get(args[0], "anonymous-selfsigned-" + UUID.randomUUID() + ".p12"); String password = "anonymous-fixture-only";
        Process process = new ProcessBuilder(Paths.get(System.getProperty("java.home"), "bin", "keytool.exe").toString(), "-genkeypair", "-alias", "fixture", "-keyalg", "RSA", "-keysize", "2048", "-validity", "1", "-dname", "CN=localhost", "-ext", "SAN=ip:127.0.0.1", "-storetype", "PKCS12", "-keystore", p12.toString(), "-storepass", password, "-keypass", password, "-noprompt").redirectErrorStream(true).start();
        process.getInputStream().transferTo(System.out); check("anonymous TLS fixture certificate generated", process.waitFor() == 0);
        KeyStore tls = KeyStore.getInstance("PKCS12"); try (java.io.InputStream input = Files.newInputStream(p12)) { tls.load(input, password.toCharArray()); } KeyManagerFactory km = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()); km.init(tls, password.toCharArray()); SSLContext ssl = SSLContext.getInstance("TLS"); ssl.init(km.getKeyManagers(), null, null);
        HttpsServer https = HttpsServer.create(new InetSocketAddress("127.0.0.1", 0), 0); https.setHttpsConfigurator(new HttpsConfigurator(ssl)); https.createContext("/", exchange -> { exchange.sendResponseHeaders(200, -1); exchange.close(); }); https.start();
        try { boolean tlsRejected = false; try (Response ignored = client.newCall(new Request.Builder().url("https://127.0.0.1:" + https.getAddress().getPort() + "/").build()).execute()) {} catch (SSLHandshakeException expected) { tlsRejected = true; } check("default TLS rejects actual selfsigned peer", tlsRejected); } finally { https.stop(0); client.dispatcher().executorService().shutdownNow(); client.connectionPool().evictAll(); }
        System.out.println("TOTAL PASS " + checks + "; AndroidKeyStore device execution remains unverified");
    }
}
