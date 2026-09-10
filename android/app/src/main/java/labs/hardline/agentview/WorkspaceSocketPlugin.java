package labs.hardline.agentview;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import androidx.activity.result.ActivityResult;
import com.journeyapps.barcodescanner.ScanOptions;
import com.journeyapps.barcodescanner.ScanIntentResult;
import java.net.URI;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.X509Certificate;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.*;
import okhttp3.*;

@CapacitorPlugin(name = "WorkspaceSocket")
public class WorkspaceSocketPlugin extends Plugin {
    private final ConcurrentHashMap<String, WebSocket> sockets = new ConcurrentHashMap<>();
    private final OkHttpClient client = new OkHttpClient.Builder().connectTimeout(7, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS).pingInterval(15, TimeUnit.SECONDS).followRedirects(false).build();

    private void event(String id, String type, String text, int code) {
        JSObject event = new JSObject();
        event.put("id", id); event.put("type", type); event.put("text", text); event.put("code", code);
        notifyListeners("socket", event);
    }

    @PluginMethod public void connect(PluginCall call) {
        String id = call.getString("id");
        try {
            String address = call.getString("address", "");
            URI uri = URI.create(address);
            if (id == null || !"wss".equals(uri.getScheme()) || uri.getUserInfo() != null || sockets.size() >= 4)
                throw new IllegalArgumentException("Invalid host address");
            OkHttpClient transport = client;
            String fingerprint = call.getString("fingerprint");
            if (fingerprint != null) {
                final String expected = fingerprint.replace(":", "").toLowerCase(java.util.Locale.ROOT);
                if (!expected.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid host identity");
                X509TrustManager pin = new X509TrustManager() {
                    public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
                    public void checkClientTrusted(X509Certificate[] chain, String authType) throws java.security.cert.CertificateException { throw new java.security.cert.CertificateException(); }
                    public void checkServerTrusted(X509Certificate[] chain, String authType) throws java.security.cert.CertificateException {
                        try {
                            StringBuilder actual = new StringBuilder();
                            for (byte b : MessageDigest.getInstance("SHA-256").digest(chain[0].getEncoded())) actual.append(String.format("%02x", b));
                            if (!MessageDigest.isEqual(expected.getBytes(java.nio.charset.StandardCharsets.US_ASCII), actual.toString().getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
                                throw new java.security.cert.CertificateException("The host identity changed. Pair again from Host.");
                        } catch (java.security.GeneralSecurityException e) { throw new java.security.cert.CertificateException(e); }
                    }
                };
                SSLContext ssl = SSLContext.getInstance("TLS");
                ssl.init(null, new TrustManager[]{pin}, null);
                // Exact certificate pin replaces CA/hostname validation only for a paired LAN origin.
                transport = client.newBuilder().sslSocketFactory(ssl.getSocketFactory(), pin).hostnameVerifier((host, session) -> true).build();
            }
            WebSocket socket = transport.newWebSocket(new Request.Builder().url(address).build(), new WebSocketListener() {
                @Override public void onOpen(WebSocket ws, Response response) { event(id, "open", "", 0); }
                @Override public void onMessage(WebSocket ws, String text) {
                    if (text.length() > 64_000_000) { ws.cancel(); return; }
                    event(id, "message", text, 0);
                }
                @Override public void onClosing(WebSocket ws, int code, String reason) { ws.close(code, reason); }
                @Override public void onClosed(WebSocket ws, int code, String reason) { sockets.remove(id); event(id, "close", reason, code); }
                @Override public void onFailure(WebSocket ws, Throwable error, Response response) {
                    sockets.remove(id);
                    if (String.valueOf(error.getMessage()).contains("identity changed")) event(id, "error", "The host identity changed. Pair again from Host.", 0);
                    event(id, "close", "Connection unavailable", 1006);
                }
            });
            sockets.put(id, socket);
            call.resolve();
        } catch (Exception e) { call.reject("Could not open a secure host connection."); }
    }
    @PluginMethod public void send(PluginCall call) {
        WebSocket socket = sockets.get(call.getString("id", ""));
        String text = call.getString("text", "");
        if (socket == null || text.length() > 2_100_000 || !socket.send(text)) { call.reject("Connection unavailable"); return; }
        call.resolve();
    }
    @PluginMethod public void close(PluginCall call) {
        WebSocket socket = sockets.remove(call.getString("id", ""));
        if (socket != null) socket.cancel();
        call.resolve();
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias("agentview-pairing")) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder("agentview-pairing", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey("agentview-pairing", null);
    }
    @PluginMethod public void save(PluginCall call) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(call.getString("value", "").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
            if (!getContext().getSharedPreferences("workspace", Context.MODE_PRIVATE).edit().putString("pairing", value).commit()) throw new Exception();
            call.resolve();
        } catch (Exception e) { call.reject("Could not securely save this device. Pair again."); }
    }
    @PluginMethod public void load(PluginCall call) {
        try {
            String value = getContext().getSharedPreferences("workspace", Context.MODE_PRIVATE).getString("pairing", null);
            JSObject result = new JSObject();
            if (value != null) {
                String[] parts = value.split(":");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                result.put("value", new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8));
            }
            call.resolve(result);
        } catch (Exception e) { call.reject("Saved pairing is unavailable. Pair again from Host."); }
    }
    @PluginMethod public void forget(PluginCall call) {
        if (!getContext().getSharedPreferences("workspace", Context.MODE_PRIVATE).edit().clear().commit()) {
            call.reject("Could not remove the saved pairing. Remove this device in Host to revoke access."); return;
        }
        call.resolve();
    }
    @PluginMethod public void copy(PluginCall call) {
        ClipboardManager clipboard = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        clipboard.setPrimaryClip(ClipData.newPlainText("AgentView", call.getString("text", ""))); call.resolve();
    }
    @PluginMethod public void scan(PluginCall call) {
        ScanOptions options = new ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setCaptureActivity(PairingCaptureActivity.class)
            .setPrompt("Keep the entire QR code inside the frame. Move back if it does not focus.")
            .setBeepEnabled(false).setOrientationLocked(true)
            .addExtra("SCAN_TYPE", 2); // Decode both normal and inverted QR images.
        startActivityForResult(call, options.createScanIntent(getContext()), "scanned");
    }
    @ActivityCallback private void scanned(PluginCall call, ActivityResult result) {
        if (call == null) return;
        ScanIntentResult scan = ScanIntentResult.parseActivityResult(result.getResultCode(), result.getData());
        if (scan.getContents() == null) { call.reject("Scan cancelled. You can also paste an invitation."); return; }
        JSObject value = new JSObject(); value.put("value", scan.getContents()); call.resolve(value);
    }
    @Override protected void handleOnDestroy() {
        for (WebSocket socket : sockets.values()) socket.cancel(); sockets.clear(); client.dispatcher().executorService().shutdown();
    }
}
