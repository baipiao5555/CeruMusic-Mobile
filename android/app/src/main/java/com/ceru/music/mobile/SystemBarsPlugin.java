package com.ceru.music.mobile;

import android.content.ComponentCallbacks;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Build;
import android.view.View;

import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SystemBars")
public class SystemBarsPlugin extends Plugin {
    private ComponentCallbacks themeCallbacks;
    private Boolean lastDarkMode;

    @Override
    public void load() {
        themeCallbacks = new ComponentCallbacks() {
            @Override
            public void onConfigurationChanged(Configuration newConfig) {
                boolean dark = isDark(newConfig);
                if (lastDarkMode != null && lastDarkMode == dark) return;
                lastDarkMode = dark;
                JSObject payload = new JSObject();
                payload.put("dark", dark);
                notifyListeners("themeChanged", payload);
            }

            @Override
            public void onLowMemory() {
            }
        };
        lastDarkMode = isDark(getContext().getResources().getConfiguration());
        getContext().getApplicationContext().registerComponentCallbacks(themeCallbacks);
    }

    @Override
    protected void handleOnDestroy() {
        if (themeCallbacks != null) {
            getContext().getApplicationContext().unregisterComponentCallbacks(themeCallbacks);
            themeCallbacks = null;
        }
        super.handleOnDestroy();
    }

    /** Current system night-mode flag; CSS prefers-color-scheme is unreliable in WebView. */
    @PluginMethod
    public void getTheme(PluginCall call) {
        JSObject result = new JSObject();
        result.put("dark", isDark(getContext().getResources().getConfiguration()));
        call.resolve(result);
    }

    private static boolean isDark(Configuration configuration) {
        return (configuration.uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    /**
     * 返回 WebView 实际被系统栏遮挡的高度（CSS px）。
     * 只计算 WebView 真正延伸到状态栏/导航栏下方的那一部分，避免重复留白。
     */
    @PluginMethod
    public void getInsets(PluginCall call) {
        View webView = getBridge().getWebView();
        View decorView = getActivity().getWindow().getDecorView();
        float density = getContext().getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;

        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(decorView);
        int statusBar = 0;
        int navigationBar = 0;
        if (insets != null) {
            statusBar = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top;
            navigationBar = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom;
        }

        int top = statusBar;
        int bottom = 0;
        if (webView != null && webView.getHeight() > 0 && decorView.getHeight() > 0) {
            int[] webPos = new int[2];
            webView.getLocationOnScreen(webPos);
            int[] windowPos = new int[2];
            decorView.getLocationOnScreen(windowPos);

            int windowHeight = decorView.getHeight();
            int webTop = webPos[1] - windowPos[1];
            int webBottom = webTop + webView.getHeight();

            top = Math.max(0, statusBar - webTop);
            bottom = Math.max(0, webBottom - (windowHeight - navigationBar));
        }

        JSObject result = new JSObject();
        result.put("top", top / density);
        result.put("bottom", bottom / density);
        call.resolve(result);
    }

    /** 系统导航栏底色与图标明暗跟随应用主题。 */
    @PluginMethod
    public void setNavigationBar(PluginCall call) {
        String color = call.getString("color");
        Boolean darkIcons = call.getBoolean("darkIcons", true);
        getActivity().runOnUiThread(() -> {
            try {
                if (color != null) {
                    getActivity().getWindow().setNavigationBarColor(Color.parseColor(color));
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    WindowCompat.getInsetsController(
                            getActivity().getWindow(),
                            getActivity().getWindow().getDecorView()
                    ).setAppearanceLightNavigationBars(Boolean.TRUE.equals(darkIcons));
                }
                call.resolve();
            } catch (IllegalArgumentException error) {
                call.reject("Invalid color: " + color);
            }
        });
    }
}
