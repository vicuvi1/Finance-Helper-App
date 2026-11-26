package app.financehelper;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import java.util.Iterator;
import org.json.JSONObject;

/**
 * window.FHAndroid in the web app (only on your own server's pages): the web app's
 * "Record payments automatically" sheet sets everything up through this.
 */
final class Bridge {
  private final Activity a;
  private final Store s;
  volatile String pageUrl = "";

  Bridge(Activity a) { this.a = a; this.s = new Store(a); }

  private boolean mine() {
    try {
      return Uri.parse(pageUrl).getHost() != null && Uri.parse(pageUrl).getHost().equals(Uri.parse(s.server()).getHost());
    } catch (Exception e) {
      return false;
    }
  }

  @JavascriptInterface public String version() { return BuildConfigHolder.VERSION; }

  /** {listener, capture, queued, apps: [{pkg, label, example, on}]} */
  @JavascriptInterface public String status() {
    if (!mine()) return "{}";
    try {
      JSONObject out = new JSONObject();
      out.put("listener", listenerOn());
      out.put("capture", !s.capture().isEmpty());
      out.put("queued", s.queue().length());
      out.put("alerts", s.alertsOn());
      out.put("askFirst", s.askFirst());
      out.put("version", BuildConfigHolder.VERSION);
      out.put("latest", s.latestVersion());
      out.put("waiting", s.pending().length());
      org.json.JSONArray list = new org.json.JSONArray();
      JSONObject apps = s.apps();
      for (Iterator<String> it = apps.keys(); it.hasNext();) {
        String pkg = it.next();
        JSONObject x = apps.getJSONObject(pkg);
        list.put(new JSONObject().put("pkg", pkg).put("label", x.optString("label", pkg)).put("example", x.optString("example")).put("on", x.optBoolean("on")).put("seen", x.optLong("seen")));
      }
      out.put("apps", list);
      return out.toString();
    } catch (Throwable e) {
      return "{}";
    }
  }

  @JavascriptInterface public void setCapture(String url) {
    if (!mine() || url == null || !url.startsWith("https://")) return;
    s.setCapture(url);
    bg(() -> Capture.send(a, null));
  }

  @JavascriptInterface public void setApp(String pkg, boolean on) {
    if (!mine()) return;
    try {
      JSONObject apps = s.apps();
      JSONObject x = apps.optJSONObject(pkg);
      if (x == null) return;
      x.put("on", on);
      apps.put(pkg, x);
      s.saveApps(apps);
    } catch (Exception ignored) { /* nothing to change */ }
  }

  /**
   * Everything the phone needs for payments to be caught reliably:
   * {listener, notify, battery, promoted (null below Android 16), capture, banks, queued, widget}.
   */
  @JavascriptInterface public String setupStatus() {
    if (!mine()) return "{}";
    try {
      JSONObject out = new JSONObject();
      out.put("listener", listenerOn());
      boolean notify = android.os.Build.VERSION.SDK_INT < 33 || a.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) == android.content.pm.PackageManager.PERMISSION_GRANTED;
      android.app.NotificationManager nm = a.getSystemService(android.app.NotificationManager.class);
      out.put("notify", notify && (nm == null || nm.areNotificationsEnabled()));
      android.os.PowerManager pm = a.getSystemService(android.os.PowerManager.class);
      out.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(a.getPackageName()));
      Object promoted = JSONObject.NULL;
      if (android.os.Build.VERSION.SDK_INT >= 36 && nm != null) {
        try { promoted = nm.getClass().getMethod("canPostPromotedNotifications").invoke(nm); } catch (Throwable ignored) { /* not on this phone */ }
      }
      out.put("promoted", promoted);
      out.put("capture", !s.capture().isEmpty());
      int banks = 0;
      JSONObject apps = s.apps();
      for (Iterator<String> it = apps.keys(); it.hasNext();) if (apps.optJSONObject(it.next()).optBoolean("on")) banks++;
      out.put("banks", banks);
      out.put("queued", s.queue().length());
      android.appwidget.AppWidgetManager wm = android.appwidget.AppWidgetManager.getInstance(a);
      out.put("widget", wm.getAppWidgetIds(new ComponentName(a, SafeWidget.class)).length);
      out.put("version", BuildConfigHolder.VERSION);
      return out.toString();
    } catch (Throwable e) {
      return "{}";
    }
  }

  /** One-tap fixes: "listener", "battery", "notify", "promoted", "app". */
  @JavascriptInterface public void fix(String what) {
    if (!mine()) return;
    a.runOnUiThread(() -> {
      try {
        Intent i;
        String pkg = a.getPackageName();
        switch (String.valueOf(what)) {
          case "listener": i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS); break;
          case "battery":
            // Samsung "Unrestricted": the app may keep its notification listener awake.
            i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
            break;
          case "notify":
          case "promoted":
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
            break;
          default: i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        a.startActivity(i);
      } catch (Throwable e) {
        // Some phones lack a screen: open the app's own settings page instead.
        try { a.startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + a.getPackageName()))); } catch (Exception ignored) { /* nothing more to try */ }
      }
    });
  }

  /** Ask before saving each payment (true) or save by itself (false). */
  @JavascriptInterface public void setAskFirst(boolean on) {
    if (!mine()) return;
    try { s.setAskFirst(on); } catch (Throwable e) { App.keep(a, e, "setAskFirst (ignored)"); forget(); }
  }

  /** Look for a newer version of the app now (the answer comes as a notification). */
  @JavascriptInterface public void checkUpdate() {
    if (!mine()) return;
    bg(() -> UpdateCheck.run(a, true));
  }

  /** Phone notifications for bills, budgets and money running low (on by default). */
  @JavascriptInterface public void setAlerts(boolean on) {
    if (!mine()) return;
    try { s.setAlertsOn(on); AlertJob.schedule(a); } catch (Throwable e) { App.keep(a, e, "setAlerts (ignored)"); forget(); }
  }

  @JavascriptInterface public void openListenerSettings() {
    if (!mine()) return;
    a.runOnUiThread(() -> { try { a.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); } catch (Throwable ignored) { /* no such screen */ } });
  }

  /** The page's own "Safe to spend today" line, for the widget (sent while the app is open). */
  @JavascriptInterface public void setWidgetLine(String line) {
    if (!mine()) return;
    // Called by the page on every screen: a problem with the widget must never close the app.
    try { Widget.fromLine(a, line); } catch (Throwable e) { App.keep(a, e, "setWidgetLine (ignored)"); forget(); }
  }

  /** Off-screen work that can never take the app down. */
  private static void bg(Runnable r) {
    new Thread(() -> { try { r.run(); } catch (Throwable ignored) { /* tried again later */ } }).start();
  }

  /** Recorded for the developer's log only, not shown as "stopped last time" (the app didn't stop). */
  private void forget() { a.getSharedPreferences("fh", android.content.Context.MODE_PRIVATE).edit().remove("crash").apply(); }

  private boolean listenerOn() {
    String flat = Settings.Secure.getString(a.getContentResolver(), "enabled_notification_listeners");
    return flat != null && flat.contains(new ComponentName(a, BankListener.class).flattenToString());
  }
}
