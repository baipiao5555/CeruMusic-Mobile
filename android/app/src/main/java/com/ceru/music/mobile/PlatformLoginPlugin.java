package com.ceru.music.mobile;

import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.view.ViewGroup;
import android.view.View;
import android.view.WindowManager;
import android.widget.ProgressBar;
import androidx.core.view.WindowCompat;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.TextView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Fixed official pages only. The remote WebView has NO Capacitor or JavaScript bridge. */
@CapacitorPlugin(name = "PlatformLogin")
public class PlatformLoginPlugin extends Plugin {
    private static final String DESKTOP_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    private MainFrameGuard guard;
    private String mobileCss = "";
    private String portalScript = "";
    private Dialog dialog;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    @Override public void load() {
        guard = MainFrameGuard.forBridge(getBridge());
        try (InputStream input = getContext().getResources().openRawResource(R.raw.platform_auth_mobile)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) { if (output.size() + count > 32768) break; output.write(buffer, 0, count); }
            mobileCss = new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception ignored) { /* Official form remains usable without cosmetic CSS. */ }
        try (InputStream input = getContext().getResources().openRawResource(R.raw.platform_portal_login)) {
            ByteArrayOutputStream output = new ByteArrayOutputStream(); byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) { if (output.size() + count > 32768) break; output.write(buffer, 0, count); }
            portalScript = new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception ignored) { /* Compatibility view is still available. */ }
    }
    @PluginMethod public void initialize(PluginCall call) { guard.initialize(call); }
    private boolean require(PluginCall call) {
        try { guard.require(call); return true; }
        catch (Exception denied) { call.reject("平台登录仅允许应用主框架调用"); return false; }
    }
    private static String site(String id) {
        if ("tx".equals(id)) return "https://y.qq.com/n/ryqq/profile";
        if ("wy".equals(id)) return "https://music.163.com/#/login";
        if ("kg".equals(id)) return "https://www.kugou.com/";
        if ("kw".equals(id)) return "https://www.kuwo.cn/";
        if ("mg".equals(id)) return "https://passport.migu.cn/login?sourceid=220029&forceAuthn=true&hideRegister=1&hideForgetPass=1&callbackURL=PostToken";
        throw new IllegalArgumentException("不支持此平台登录");
    }
    private static String title(String id) {
        if ("tx".equals(id)) return "QQ音乐";
        if ("wy".equals(id)) return "网易云音乐";
        if ("kg".equals(id)) return "酷狗音乐";
        if ("kw".equals(id)) return "酷我音乐";
        if ("mg".equals(id)) return "咪咕音乐";
        throw new IllegalArgumentException("不支持此平台登录");
    }
    /** QQ music uses its current official page; the old graph mobile form is no longer usable. */
    private static String entry(String id, boolean desktop, boolean wechat) {
        if ("kg".equals(id) && !desktop) return "https://m.kugou.com/loginReg.php?act=login";
        if ("wy".equals(id)) return site(id);
        if (!"tx".equals(id)) return site(id);
        if (!wechat) return site(id);
        String redirect = "https://y.qq.com/portal/wx_redirect.html?login_type=" + (wechat ? "2" : "1") + "&surl=" + Uri.encode(site(id));
        return Uri.parse("https://open.weixin.qq.com/connect/qrconnect").buildUpon()
                .appendQueryParameter("appid", "wx48db31d50e334801").appendQueryParameter("redirect_uri", redirect)
                .appendQueryParameter("response_type", "code").appendQueryParameter("scope", "snsapi_login")
                .appendQueryParameter("state", "STATE").build().toString();
    }
    private String mobileUserAgent() {
        // Some login providers reject the WebView token. Keep the real engine version, but present a Chrome mobile UA.
        return WebSettings.getDefaultUserAgent(getContext()).replace("; wv", "").replace("Version/4.0 ", "");
    }
    private String cookieHeader(String id, String url) {
        CookieManager manager = CookieManager.getInstance();
        StringBuilder raw = new StringBuilder();
        appendCookie(raw, manager.getCookie(url));
        if ("wy".equals(id)) appendCookie(raw, manager.getCookie("https://y.music.163.com/m/login"));
        if ("tx".equals(id)) appendCookie(raw, manager.getCookie("https://graph.qq.com/"));
        if ("kg".equals(id)) appendCookie(raw, manager.getCookie("https://m.kugou.com/loginReg.php?act=login"));
        if ("mg".equals(id)) appendCookie(raw, manager.getCookie("https://music.migu.cn/v5/"));
        return raw.toString();
    }
    private static void appendCookie(StringBuilder raw, String value) {
        if (value == null || value.isEmpty()) return;
        if (raw.length() > 0) raw.append("; ");
        raw.append(value);
    }
    private GradientDrawable rounded(int color, int radiusDp) {
        GradientDrawable shape = new GradientDrawable(); shape.setColor(color);
        shape.setCornerRadius(radiusDp * getContext().getResources().getDisplayMetrics().density); return shape;
    }
    private static String[] cookieNames(String id) {
        if ("tx".equals(id)) return new String[]{"uin", "qqmusic_uin", "qqmusic_key", "qm_keyst", "wxuin", "wxmusic_key", "psrf_login_type"};
        if ("wy".equals(id)) return new String[]{"MUSIC_U", "__csrf"};
        // kg_mid is issued by the official mobile site and is used by its playlist JSON pages.
        if ("kg".equals(id)) return new String[]{"KuGoo", "kg_mid"};
        // Hm_Iuvt... is the current kuwo.cn /api/www signing cookie; Secret is derived from it.
        if ("kw".equals(id)) return new String[]{"userid", "sid", "websid", "username", "uname3", "logintype", "t3", "t3kwid",
                "Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324"};
        // Official Migu music SDK uses pacmtoken on .migu.cn with sourceid 220029.
        if ("mg".equals(id)) return new String[]{"pacmtoken"};
        throw new IllegalArgumentException("不支持此平台登录");
    }
    private static Map<String, String> cookies(String id, String raw) {
        if (raw == null || raw.length() > 65536 || raw.contains("\r") || raw.contains("\n")) throw new IllegalArgumentException("平台会话无效");
        Map<String, String> values = new LinkedHashMap<>();
        for (String part : raw.split(";")) {
            int index = part.indexOf('='); if (index < 1) continue;
            String name = part.substring(0, index).trim(), value = part.substring(index + 1).trim();
            for (String allowed : cookieNames(id)) if (name.equals(allowed) && !value.isEmpty()) values.put(name, value);
        }
        return values;
    }
    private static String header(Map<String, String> values) {
        StringBuilder result = new StringBuilder();
        for (Map.Entry<String, String> item : values.entrySet()) {
            if (result.length() > 0) result.append("; ");
            result.append(item.getKey()).append('=').append(item.getValue());
        }
        return result.toString();
    }
    private static String suffix(String id) {
        if ("tx".equals(id)) return "qq.com";
        if ("wy".equals(id)) return "163.com";
        if ("kg".equals(id)) return "kugou.com";
        if ("kw".equals(id)) return "kuwo.cn";
        if ("mg".equals(id)) return "migu.cn";
        throw new IllegalArgumentException("不支持此平台登录");
    }
    private static boolean allowed(String id, String raw) {
        Uri uri = Uri.parse(raw); String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || host == null || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
        String suffix = suffix(id);
        return host.equals(suffix) || host.endsWith("." + suffix) || host.equals("open.weixin.qq.com")
                || "mg".equals(id) && (host.equals("graph.qq.com") || host.equals("xui.ptlogin2.qq.com") || host.equals("www.cmpassport.com"));
    }
    private static void clearCookies(String id) {
        String host = Uri.parse(site(id)).getHost();
        String suffix = suffix(id);
        CookieManager manager = CookieManager.getInstance();
        // Clear this platform's temporary browser cookies, not the app's Logto or unrelated websites.
        java.util.Set<String> names = new java.util.HashSet<>(java.util.Arrays.asList(cookieNames(id)));
        String current = manager.getCookie(site(id));
        if (current != null) for (String part : current.split(";")) {
            int index = part.indexOf('=');
            if (index > 0) names.add(part.substring(0, index).trim());
        }
        for (String name : names) {
            manager.setCookie(site(id), name + "=; Max-Age=0; Path=/; Secure");
            manager.setCookie(site(id), name + "=; Max-Age=0; Path=/; Secure; Domain=" + host);
            manager.setCookie(site(id), name + "=; Max-Age=0; Path=/; Secure; Domain=." + suffix);
            if ("kg".equals(id)) manager.setCookie("https://m.kugou.com/loginReg.php?act=login", name + "=; Max-Age=0; Path=/; Secure");
            if ("mg".equals(id)) manager.setCookie("https://music.migu.cn/v5/", name + "=; Max-Age=0; Path=/; Secure");
        }
        manager.flush();
        WebStorage.getInstance().deleteOrigin("https://" + host);
        if ("kg".equals(id)) WebStorage.getInstance().deleteOrigin("https://m.kugou.com");
        if ("mg".equals(id)) WebStorage.getInstance().deleteOrigin("https://music.migu.cn");
    }
    @SuppressWarnings("deprecation")
    @PluginMethod public void open(PluginCall call) {
        if (!require(call)) return;
        String id = call.getString("platform");
        final String url;
        try { url = site(id); } catch (Exception error) { call.reject("不支持此平台登录"); return; }
        getActivity().runOnUiThread(() -> {
            if (!require(call)) return;
            if (dialog != null) { call.reject("请先关闭当前网页登录"); return; }
            clearCookies(id);
            Dialog window = new Dialog(getActivity(), android.R.style.Theme_Material_Light_NoActionBar);
            dialog = window;
            View layout = getActivity().getLayoutInflater().inflate(R.layout.platform_login, null);
            TextView status = layout.findViewById(R.id.login_status), origin = layout.findViewById(R.id.login_origin);
            TextView brand = layout.findViewById(R.id.login_brand), heading = layout.findViewById(R.id.login_title);
            TextView compat = layout.findViewById(R.id.login_compat), qq = layout.findViewById(R.id.login_qq), wx = layout.findViewById(R.id.login_wechat);
            ProgressBar progress = layout.findViewById(R.id.login_progress);
            Button done = layout.findViewById(R.id.login_done);
            WebView web = layout.findViewById(R.id.login_web);
            heading.setText(title(id) + "登录");
            brand.setText("tx".equals(id) ? "QQ" : "wy".equals(id) ? "NE" : "kg".equals(id) ? "KG" : "kw".equals(id) ? "KW" : "MG");
            brand.setBackground(rounded(Color.parseColor("#E8F8EF"), 12));
            final boolean[] desktop = { "tx".equals(id) }, wechat = { false };
            final int[] presentationVersion = { 0 };
            if (!"tx".equals(id)) layout.findViewById(R.id.login_methods).setVisibility(View.GONE);
            WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setSaveFormData(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
            settings.setSupportZoom(true); settings.setBuiltInZoomControls(true); settings.setDisplayZoomControls(false);
            settings.setUseWideViewPort(true); settings.setLoadWithOverviewMode(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
            CookieManager.getInstance().setAcceptCookie(true);
            Runnable loadPage = () -> {
                String target = entry(id, desktop[0], wechat[0]);
                settings.setUserAgentString(desktop[0] || "kw".equals(id) ? DESKTOP_UA : mobileUserAgent());
                origin.setText(Uri.parse(target).getHost() + " · 官方安全网页");
                status.setText("tx".equals(id) ? "在官方网页选择「密码登录」或扫码，完成后点下方按钮。" : "请在官方页面完成登录，再点下方按钮。");
                compat.setText("tx".equals(id) ? "重新加载" : desktop[0] ? "手机视图" : "兼容视图");
                qq.setBackground(rounded(Color.parseColor(wechat[0] ? "#F6F8F7" : "#E8F8EF"), 9));
                wx.setBackground(rounded(Color.parseColor(wechat[0] ? "#E8F8EF" : "#F6F8F7"), 9));
                presentationVersion[0]++; done.setEnabled(false); progress.setVisibility(View.VISIBLE); web.loadUrl(target);
            };
            layout.findViewById(R.id.login_close).setOnClickListener(v -> window.dismiss());
            compat.setOnClickListener(v -> { if ("tx".equals(id)) { loadPage.run(); return; } desktop[0] = !desktop[0]; loadPage.run(); });
            qq.setOnClickListener(v -> { wechat[0] = false; loadPage.run(); });
            wx.setOnClickListener(v -> { wechat[0] = true; loadPage.run(); });
            web.setWebChromeClient(new WebChromeClient() {
                @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); progress.setVisibility(value == 100 ? View.INVISIBLE : View.VISIBLE); }
            });
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return block(request.getUrl().toString()); }
                @Override public boolean shouldOverrideUrlLoading(WebView view, String next) { return block(next); }
                private boolean block(String next) { if (allowed(id, next)) return false; status.setText("已阻止非受信任或非 HTTPS 登录跳转；请使用网页扫码/账号方式。"); return true; }
                @Override public void onPageFinished(WebView view, String current) {
                    if (allowed(id, current)) {
                        Uri currentUri = Uri.parse(current); origin.setText(currentUri.getHost() + " · 官方安全网页"); done.setEnabled(true);
                        if (!desktop[0] && "graph.qq.com".equals(currentUri.getHost()) && "/oauth2.0/show".equals(currentUri.getPath())) {
                            // Insert only a stylesheet into the original official page. Never read/replace password inputs.
                            view.evaluateJavascript("(function(){var s=document.getElementById('ceru-mobile-style');if(!s){s=document.createElement('style');s.id='ceru-mobile-style';document.head.appendChild(s);}s.textContent=" + JSONObject.quote(mobileCss) + ";})()", null);
                        }
                        if (("tx".equals(id) && desktop[0]) || (!desktop[0] && ("kg".equals(id) || "kw".equals(id)))) {
                            preparePresentation(view, 0, presentationVersion[0]);
                        }
                        if (!desktop[0] && "wy".equals(id)) {
                            // Hide only the carrier quick-login probe; its timeout toast overlays the official SMS form.
                            view.evaluateJavascript("(function(){function h(){var f=document.querySelectorAll('iframe[src*=\\\"urs-nelogin-agent\\\"]');for(var i=0;i<f.length;i++){f[i].style.display='none';}}h();if(!window.__ceruWyHide){window.__ceruWyHide=new MutationObserver(h);window.__ceruWyHide.observe(document.documentElement,{childList:true,subtree:true});}})()", null);
                        }
                    }
                }
                private void preparePresentation(WebView view, int attempt, int version) {
                    if (version != presentationVersion[0] || dialog != window || portalScript.isEmpty()) return;
                    done.setEnabled(false);
                    view.evaluateJavascript(portalScript + "(" + JSONObject.quote(id) + ")", result -> {
                        if (version != presentationVersion[0] || dialog != window) return;
                        boolean ready = false;
                        try { ready = new JSONObject(result).optBoolean("ready"); } catch (Exception ignored) { }
                        if (ready) { done.setEnabled(true); return; }
                        if (attempt < 24) view.postDelayed(() -> preparePresentation(view, attempt + 1, version), 250);
                        else { status.setText("tx".equals(id) ? "官方登录层未加载，请点右上角重新加载。" : "专用登录视图未能加载，请切换兼容视图。"); done.setEnabled(true); }
                    });
                }
                @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); status.setText("登录网页证书错误，未放行；请检查网络。"); }
            });
            final boolean[] completed = { false };
            done.setOnClickListener(v -> {
                if (!require(call)) { window.dismiss(); return; }
                String raw = cookieHeader(id, url);
                Map<String, String> values;
                try { values = cookies(id, raw); } catch (Exception e) { status.setText("还没有取得平台会话，请先在网页完成登录。"); return; }
                boolean present = "tx".equals(id) ? values.containsKey("qqmusic_key") || values.containsKey("qm_keyst") || values.containsKey("wxmusic_key") : "wy".equals(id) ? values.containsKey("MUSIC_U") : "kg".equals(id) ? values.containsKey("KuGoo") : "mg".equals(id) ? values.containsKey("pacmtoken") : values.containsKey("sid") || values.containsKey("websid");
                if (!present) { status.setText("还没有取得登录会话。请先点击网页的登录入口并完成登录。"); return; }
                JSObject result = new JSObject(); result.put("cookies", header(values)); completed[0] = true;
                call.resolve(result); window.dismiss();
            });
            window.setContentView(layout);
            window.setOnDismissListener(d -> { web.stopLoading(); web.loadUrl("about:blank"); web.destroy(); clearCookies(id); dialog = null; if (!completed[0]) call.reject("LOGIN_CANCELLED"); });
            window.show(); window.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
            window.getWindow().setStatusBarColor(Color.WHITE); window.getWindow().setNavigationBarColor(Color.WHITE);
            window.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
            WindowCompat.setDecorFitsSystemWindows(window.getWindow(), true);
            WindowCompat.getInsetsController(window.getWindow(), window.getWindow().getDecorView()).setAppearanceLightStatusBars(true);
            WindowCompat.getInsetsController(window.getWindow(), window.getWindow().getDecorView()).setAppearanceLightNavigationBars(true);
            loadPage.run();
        });
    }
    @PluginMethod public void verify(PluginCall call) {
        if (!require(call)) return;
        String id = call.getString("platform"), raw = call.getString("cookies");
        final Map<String, String> values;
        try { values = cookies(id, raw); if (!("tx".equals(id) || "wy".equals(id))) throw new Exception(); }
        catch (Exception invalid) { call.reject("平台身份接口尚未适配或会话无效"); return; }
        executor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                guard.require(call);
                String endpoint = "wy".equals(id) ? "https://music.163.com/api/nuser/account/get" : "https://u.y.qq.com/cgi-bin/musicu.fcg";
                connection = (HttpURLConnection) new URL(endpoint).openConnection();
                connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(15000);
                connection.setRequestProperty("Cookie", header(values));
                connection.setRequestProperty("Referer", "wy".equals(id) ? "https://music.163.com/" : "https://y.qq.com/");
                connection.setRequestProperty("User-Agent", "Mozilla/5.0");
                if ("tx".equals(id)) {
                    JSONObject comm = new JSONObject().put("ct", 24).put("cv", 0).put("format", "json");
                    String key = values.getOrDefault("qm_keyst", values.getOrDefault("qqmusic_key", values.getOrDefault("wxmusic_key", "")));
                    String uin = values.getOrDefault("qqmusic_uin", values.getOrDefault("uin", values.getOrDefault("wxuin", "0"))).replaceFirst("^o0*", "");
                    int hash = 5381; for (char c : key.toCharArray()) hash += (hash << 5) + c;
                    comm.put("uin", uin).put("authst", key).put("g_tk", hash & 0x7fffffff).put("tmeLoginType", key.startsWith("W_X") ? 2 : 1);
                    JSONObject payload = new JSONObject().put("comm", comm).put("req", new JSONObject().put("module", "music.UserInfo.userInfoServer").put("method", "GetLoginUserInfo").put("param", new JSONObject()));
                    connection.setRequestMethod("POST"); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json");
                    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(payload.toString().getBytes(StandardCharsets.UTF_8)); }
                }
                int status = connection.getResponseCode();
                if (status != 200) throw new Exception("Identity HTTP error");
                ByteArrayOutputStream output = new ByteArrayOutputStream();
                try (InputStream input = connection.getInputStream()) { byte[] buffer = new byte[4096]; int count; while ((count = input.read(buffer)) != -1) { if (output.size() + count > 262144) throw new Exception("Identity response too large"); output.write(buffer, 0, count); } }
                guard.require(call); JSObject result = new JSObject(); result.put("status", status); result.put("body", new String(output.toByteArray(), StandardCharsets.UTF_8)); call.resolve(result);
            } catch (Exception error) { call.reject("平台身份核验失败，请检查网络或重新登录"); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    @Override protected void handleOnDestroy() { if (dialog != null) getActivity().runOnUiThread(() -> { if (dialog != null) dialog.dismiss(); }); executor.shutdownNow(); super.handleOnDestroy(); }
}
