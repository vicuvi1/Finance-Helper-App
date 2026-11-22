package app.financehelper;

import android.content.Context;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONArray;
import org.json.JSONObject;

/** Sends a bank message to your server's private capture link (api/capture.mjs), which records it. */
final class Capture {
  private Capture() {}

  /** POSTs text; returns the server's JSON or null when it couldn't be reached. Run off the main thread. */
  static JSONObject post(String url, String body, String type) {
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(url).openConnection();
      c.setConnectTimeout(15000);
      c.setReadTimeout(20000);
      c.setRequestMethod("POST");
      c.setDoOutput(true);
      c.setRequestProperty("Content-Type", type);
      try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
      int code = c.getResponseCode();
      if (code != 200) return code == 404 ? new JSONObject().put("gone", true) : null;
      try (InputStream in = c.getInputStream()) {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return new JSONObject(b.toString("UTF-8"));
      }
    } catch (Exception e) {
      return null;
    } finally {
      if (c != null) c.disconnect();
    }
  }

  /** Sends one message (and any waiting ones). Waiting ones are kept when offline. */
  static void send(Context ctx, String text) {
    Store s = new Store(ctx);
    String url = s.capture();
    JSONArray q = s.queue();
    if (text != null) q.put(text);
    if (url.isEmpty()) { trim(q); s.saveQueue(q); return; }
    JSONArray left = new JSONArray();
    for (int i = 0; i < q.length(); i++) {
      String t = q.optString(i);
      // Quick adds wait as JSON ({"quick": "120 lunch", "at": …}); bank messages as plain text.
      JSONObject r = post(url, t, t.startsWith("{") ? "application/json" : "text/plain; charset=utf-8");
      if (r == null) { left.put(t); continue; }
      if (r.optBoolean("saved")) Widget.fromLine(ctx, r.optString("text"));
    }
    trim(left);
    s.saveQueue(left);
  }

  /** The quick-add tile: "120 lunch", sent now or as soon as there's internet. Returns the server's line or null (queued). */
  static String quick(Context ctx, String text) {
    try {
      String body = new JSONObject().put("quick", text).put("at", System.currentTimeMillis()).toString();
      Store s = new Store(ctx);
      String url = s.capture();
      JSONObject r = url.isEmpty() ? null : post(url, body, "application/json");
      if (r == null || r.optBoolean("gone")) {
        JSONArray q = s.queue();
        q.put(body);
        trim(q);
        s.saveQueue(q);
        return null;
      }
      if (r.optBoolean("saved")) Widget.fromLine(ctx, r.optString("text"));
      return r.optString("text", "Saved");
    } catch (Exception e) {
      return null;
    }
  }

  /** The phone notifications your server has for you (bills due, budgets, money low). */
  static JSONArray alerts(Context ctx) {
    String url = new Store(ctx).capture();
    if (url.isEmpty()) return null;
    JSONObject r = post(url + (url.contains("?") ? "&" : "?") + "q=alerts", "{}", "application/json");
    return r == null ? null : r.optJSONArray("alerts");
  }

  private static void trim(JSONArray q) { while (q.length() > 50) q.remove(0); }

  /** Today's Safe to spend line from the server (for the widget). */
  static String safeLine(Context ctx) {
    String url = new Store(ctx).capture();
    if (url.isEmpty()) return null;
    JSONObject r = post(url + (url.contains("?") ? "&" : "?") + "q=safe", "{}", "application/json");
    return r == null ? null : r.optString("line", null);
  }
}
