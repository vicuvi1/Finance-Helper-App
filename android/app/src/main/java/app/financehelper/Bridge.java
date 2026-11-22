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
      org.json.JSONArray list = new org.json.JSONArray();
      JSONObject apps = s.apps();
      for (Iterator<String> it = apps.keys(); it.hasNext();) {
        String pkg = it.next();
        JSONObject x = apps.getJSONObject(pkg);
        list.put(new JSONObject().put("pkg", pkg).put("label", x.optString("label", pkg)).put("example", x.optString("example")).put("on", x.optBoolean("on")).put("seen", x.optLong("seen")));
      }
      out.put("apps", list);
      return out.toString();
    } catch (Exception e) {
      return "{}";
    }
  }

  @JavascriptInterface public void setCapture(String url) {
    if (!mine() || url == null || !url.startsWith("https://")) return;
    s.setCapture(url);
    new Thread(() -> Capture.send(a, null)).start();
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

  @JavascriptInterface public void openListenerSettings() {
    if (!mine()) return;
    a.runOnUiThread(() -> a.startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
  }

  /** The page's own "Safe to spend today" line, for the widget (sent while the app is open). */
  @JavascriptInterface public void setWidgetLine(String line) {
    if (!mine()) return;
    Widget.fromLine(a, line);
  }

  private boolean listenerOn() {
    String flat = Settings.Secure.getString(a.getContentResolver(), "enabled_notification_listeners");
    return flat != null && flat.contains(new ComponentName(a, BankListener.class).flattenToString());
  }
}
