package com.ceru.music.mobile;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;

import java.net.InetAddress;
import java.net.URI;
import java.net.URL;

/**
 * Shared SSRF guard for native code that opens URLs supplied by plugins or
 * remote metadata (artwork, downloads). Only public HTTP(S) hosts are allowed.
 */
final class NetworkSafety {
    private NetworkSafety() {}

    static void validate(Context context, URL url) throws Exception {
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
        boolean vpnActive = isVpnActive(context);
        boolean domainName = !isIpLiteral(host);
        for (InetAddress address : addresses) {
            if (isBlockedAddress(address)) {
                if (isVpnFakeAddress(address) && (vpnActive || domainName)) continue;
                throw new Exception("出于安全原因，不能访问本机、回环或局域网地址");
            }
        }
    }

    private static boolean isIpLiteral(String host) {
        return host.indexOf(':') >= 0 || host.matches("\\d{1,3}(\\.\\d{1,3}){3}");
    }

    private static boolean isVpnActive(Context context) {
        ConnectivityManager manager =
                (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
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
}
