package app.financehelper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
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

  /** What you see when the server no longer knows this phone's link (after "New link" in the app). */
  static final String LINK_CHANGED = "Not sent: the link changed. Open Finance Helper and set up the phone again. Kept on the phone until then.";

  /**
   * POSTs text; returns the server's JSON, null when it couldn't be reached, or {gone: true} when the
   * server refuses this link (an old link after "New link"). Run off the main thread.
   */
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
      if (code != 200) return code == 404 || code == 401 || code == 403 || code == 410 ? new JSONObject().put("gone", true) : null;
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
      if (gone(ctx, r)) {
        // The link changed: nothing was saved. Keep this one and the rest for the new link.
        for (int k = i; k < q.length(); k++) left.put(q.optString(k));
        break;
      }
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
      boolean gone = gone(ctx, r);
      if (r == null || gone) {
        JSONArray q = s.queue();
        q.put(body);
        trim(q);
        s.saveQueue(q);
        return gone ? LINK_CHANGED : null;
      }
      if (r.optBoolean("saved")) Widget.fromLine(ctx, r.optString("text"));
      return r.optString("text", "Saved");
    } catch (Exception e) {
      return null;
    }
  }

  /** What a payment would be saved as (nothing saved): the server's preview, or null offline. */
  static JSONObject preview(Context ctx, String text, long at) {
    String url = new Store(ctx).capture();
    if (url.isEmpty()) return null;
    try {
      String body = new JSONObject().put("text", text).put("at", at).toString();
      JSONObject r = post(url + (url.contains("?") ? "&" : "?") + "q=preview", body, "application/json");
      return gone(ctx, r) ? null : r; // no preview: the payment is still asked about and kept
    } catch (Exception e) {
      return null;
    }
  }

  /** Saves a payment you confirmed (with any changes); kept and sent later when offline. Returns the server's line or null. */
  static String confirm(Context ctx, JSONObject body) {
    Store s = new Store(ctx);
    String url = s.capture();
    String json = body.toString();
    JSONObject r = url.isEmpty() ? null : post(url, json, "application/json");
    boolean gone = gone(ctx, r);
    if (r == null || gone) {
      JSONArray q = s.queue();
      q.put(json);
      trim(q);
      s.saveQueue(q);
      return gone ? LINK_CHANGED : null;
    }
    if (r.optBoolean("saved")) Widget.fromLine(ctx, r.optString("text"));
    return r.optString("text", "Saved");
  }

  /** The phone notifications your server has for you (bills due, budgets, money low). */
  static JSONArray alerts(Context ctx) {
    String url = new Store(ctx).capture();
    if (url.isEmpty()) return null;
    JSONObject r = post(url + (url.contains("?") ? "&" : "?") + "q=alerts", "{}", "application/json");
    return r == null ? null : r.optJSONArray("alerts");
  }

  /** Did the server refuse this link? Then tell you once a day to set up the phone again. */
  private static boolean gone(Context ctx, JSONObject r) {
    if (r == null || !r.optBoolean("gone")) return false;
    try {
      Store s = new Store(ctx);
      long now = System.currentTimeMillis();
      if (now - s.linkGoneAt() < 20 * 3600 * 1000L) return true;
      s.setLinkGoneAt(now);
      NotificationManager nm = ctx.getSystemService(NotificationManager.class);
      if (nm == null) return true;
      nm.createNotificationChannel(new NotificationChannel("fh", "Finance Helper", NotificationManager.IMPORTANCE_DEFAULT));
      Intent open = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("fh://open/phone-pay"));
      PendingIntent pi = PendingIntent.getActivity(ctx, 2, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
      nm.notify(4403, new Notification.Builder(ctx, "fh")
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle("Payments are not being recorded")
        .setContentText("The link changed. Tap to set up this phone again; payments wait on the phone until then.")
        .setStyle(new Notification.BigTextStyle().bigText("The link changed. Tap to set up this phone again; payments wait on the phone until then."))
        .setContentIntent(pi)
        .setAutoCancel(true)
        .build());
    } catch (Exception ignored) {
      // The payment is kept either way.
    }
    return true;
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
