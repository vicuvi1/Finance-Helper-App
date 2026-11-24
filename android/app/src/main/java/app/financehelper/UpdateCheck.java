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
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Once a day (and when you open the app): is there a newer Finance Helper for Android on the
 * releases page? Then a notification "Update to 1.133 — tap to install" opens the download.
 */
final class UpdateCheck {
  private UpdateCheck() {}
  static final String LATEST = "https://api.github.com/repos/vicuvi1/Finance-Helper-App/releases/latest";
  static final String APK = "https://github.com/vicuvi1/Finance-Helper-App/releases/latest/download/finance-helper.apk";

  /** Runs off the main thread. `force`: check even if checked today. */
  static void run(Context ctx, boolean force) {
    Store s = new Store(ctx);
    long now = System.currentTimeMillis();
    if (!force && now - s.lastUpdateCheck() < 20 * 3600 * 1000L) return;
    s.setLastUpdateCheck(now);
    String latest = latest();
    if (latest == null) return;
    s.setLatestVersion(latest);
    if (newer(latest, BuildConfigHolder.VERSION)) notifyUpdate(ctx, latest);
  }

  /** The newest release's version that carries the Android app ("1.133.0"), or null. */
  static String latest() {
    HttpURLConnection c = null;
    try {
      c = (HttpURLConnection) new URL(LATEST).openConnection();
      c.setConnectTimeout(10000);
      c.setReadTimeout(15000);
      c.setRequestProperty("Accept", "application/vnd.github+json");
      if (c.getResponseCode() != 200) return null;
      try (InputStream in = c.getInputStream()) {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        JSONObject j = new JSONObject(b.toString("UTF-8"));
        JSONArray assets = j.optJSONArray("assets");
        boolean hasApk = false;
        for (int i = 0; assets != null && i < assets.length(); i++) if ("finance-helper.apk".equals(assets.optJSONObject(i).optString("name"))) hasApk = true;
        String tag = j.optString("tag_name", "").replaceFirst("^v", "");
        return hasApk && tag.matches("\\d+\\.\\d+\\.\\d+") ? tag : null;
      }
    } catch (Exception e) {
      return null;
    } finally {
      if (c != null) c.disconnect();
    }
  }

  static boolean newer(String a, String b) {
    try {
      String[] x = a.split("\\.");
      String[] y = (b == null || b.isEmpty() ? "0.0.0" : b).split("\\.");
      for (int i = 0; i < 3; i++) {
        int d = Integer.parseInt(x[i]) - Integer.parseInt(y[i]);
        if (d != 0) return d > 0;
      }
    } catch (Exception ignored) { /* not a version */ }
    return false;
  }

  static void notifyUpdate(Context ctx, String v) {
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    if (nm == null) return;
    nm.createNotificationChannel(new NotificationChannel("updates", "App updates", NotificationManager.IMPORTANCE_DEFAULT));
    PendingIntent pi = PendingIntent.getActivity(ctx, 40, new Intent(Intent.ACTION_VIEW, Uri.parse(APK)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), PendingIntent.FLAG_IMMUTABLE);
    nm.notify(4402, new Notification.Builder(ctx, "updates")
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setContentTitle("Finance Helper " + v + " is ready")
      .setContentText("Tap to download, then open the file to update. Your data stays.")
      .setContentIntent(pi)
      .setAutoCancel(true)
      .build());
  }
}
