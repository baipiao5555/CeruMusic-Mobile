package com.ceru.music.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** App-owned namespaces only. Plugin RPC callers must never choose another owner's namespace. */
@CapacitorPlugin(name = "SecretStore")
public class SecretStorePlugin extends Plugin {
    private static final String PREFS = "ceru-secret-store-v1";
    private static final int MAX_BYTES = 256 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private MainFrameGuard guard;
    @Override public void load() { guard = MainFrameGuard.forBridge(getBridge()); }
    @PluginMethod public void initialize(PluginCall call) { guard.initialize(call); }

    private void respond(PluginCall call, Callable<JSObject> task) {
        try { guard.require(call); } catch (Exception denied) { call.reject("安全凭据服务仅允许受信任主框架调用"); return; }
        executor.execute(() -> {
            try { guard.require(call); JSObject result = task.call(); guard.require(call); call.resolve(result); }
            catch (Exception error) { call.reject("安全凭据操作失败，请检查安全仓库或重新配置"); }
        });
    }
    private static String valid(String value) throws Exception {
        if (value == null || !value.matches("[A-Za-z0-9._:-]{1,160}")) throw new Exception("Invalid identity");
        return value;
    }
    private static String digest(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder();
        for (byte b : bytes) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return out.toString();
    }
    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE); }
    private static KeyStore keyStore() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null); return store;
    }
    private static String alias(String namespace) throws Exception { return "ceru.secret.v1." + digest(namespace); }
    private static SecretKey key(String namespace, boolean create) throws Exception {
        KeyStore store = keyStore(); String alias = alias(namespace);
        if (store.containsAlias(alias)) return (SecretKey) store.getKey(alias, null);
        if (!create) throw new Exception("Missing key");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private static String entry(String namespace, String name) throws Exception { return digest(namespace) + ":" + digest(name); }
    private static byte[] aad(String namespace, String name) { return (namespace + "\0" + name).getBytes(StandardCharsets.UTF_8); }
    @PluginMethod public void status(PluginCall call) {
        respond(call, () -> { keyStore(); JSObject result = new JSObject(); result.put("backend", "android-keystore-aes-gcm"); result.put("persistent", true); result.put("encryptedAtRest", true); return result; });
    }
    @PluginMethod public void get(PluginCall call) {
        respond(call, () -> {
            String namespace = valid(call.getString("namespace")), name = valid(call.getString("key"));
            String raw = prefs().getString(entry(namespace, name), null); JSObject result = new JSObject();
            if (raw == null) { result.put("value", JSONObject.NULL); return result; }
            JSONObject data = new JSONObject(raw);
            if (data.getInt("version") != 1) throw new Exception("Unsupported ciphertext");
            byte[] iv = Base64.decode(data.getString("iv"), Base64.NO_WRAP);
            byte[] encrypted = Base64.decode(data.getString("ciphertext"), Base64.NO_WRAP);
            if (iv.length != 12 || encrypted.length > MAX_BYTES + 16) throw new Exception("Invalid ciphertext");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(namespace, false), new GCMParameterSpec(128, iv)); cipher.updateAAD(aad(namespace, name));
            result.put("value", new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)); return result;
        });
    }
    @PluginMethod public void set(PluginCall call) {
        respond(call, () -> {
            String namespace = valid(call.getString("namespace")), name = valid(call.getString("key")), value = call.getString("value");
            if (value == null || value.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new Exception("Invalid secret");
            if (!prefs().contains(entry(namespace, name)) && prefs().getAll().size() >= 512) throw new Exception("Secret count limit exceeded");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key(namespace, true)); cipher.updateAAD(aad(namespace, name));
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            JSONObject data = new JSONObject(); data.put("version", 1); data.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)); data.put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP));
            if (!prefs().edit().putString(entry(namespace, name), data.toString()).commit()) throw new Exception("Persistence failed");
            return new JSObject();
        });
    }
    @PluginMethod public void remove(PluginCall call) {
        respond(call, () -> {
            String namespace = valid(call.getString("namespace")), name = valid(call.getString("key"));
            if (!prefs().edit().remove(entry(namespace, name)).commit()) throw new Exception("Persistence failed"); return new JSObject();
        });
    }
    @PluginMethod public void clearNamespace(PluginCall call) {
        respond(call, () -> {
            String namespace = valid(call.getString("namespace")), prefix = digest(namespace) + ":";
            SharedPreferences.Editor edit = prefs().edit();
            for (String name : prefs().getAll().keySet()) if (name.startsWith(prefix)) edit.remove(name);
            if (!edit.commit()) throw new Exception("Persistence failed");
            KeyStore store = keyStore(); if (store.containsAlias(alias(namespace))) store.deleteEntry(alias(namespace)); return new JSObject();
        });
    }
    @Override protected void handleOnDestroy() { executor.shutdown(); super.handleOnDestroy(); }
}
