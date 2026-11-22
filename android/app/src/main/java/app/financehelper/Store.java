package app.financehelper;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

/** What the app keeps on this phone: the server, the private capture link, the bank apps you picked, the widget's line. */
final class Store {
  static final String DEFAULT_SERVER = "https://mega-system-ten.vercel.app";
  private final SharedPreferences p;

  Store(Context c) { p = c.getSharedPreferences("fh", Context.MODE_PRIVATE); }

  String server() { return p.getString("server", DEFAULT_SERVER); }
  void setServer(String s) { p.edit().putString("server", s).apply(); }
  String capture() { return p.getString("capture", ""); }
  void setCapture(String s) { p.edit().putString("capture", s).apply(); }

  /** Apps that showed a notification that looks like a payment: {pkg: {label, example, on, seen}}. */
  JSONObject apps() {
    try { return new JSONObject(p.getString("apps", "{}")); } catch (Exception e) { return new JSONObject(); }
  }
  void saveApps(JSONObject o) { p.edit().putString("apps", o.toString()).apply(); }
  boolean appOn(String pkg) { JSONObject a = apps().optJSONObject(pkg); return a != null && a.optBoolean("on"); }

  /** Payments that couldn't be sent yet (offline): sent with the next one. */
  JSONArray queue() {
    try { return new JSONArray(p.getString("queue", "[]")); } catch (Exception e) { return new JSONArray(); }
  }
  void saveQueue(JSONArray q) { p.edit().putString("queue", q.toString()).apply(); }

  String widgetAmount() { return p.getString("w_amount", ""); }
  String widgetNote() { return p.getString("w_note", ""); }
  void setWidget(String amount, String note) { p.edit().putString("w_amount", amount).putString("w_note", note).apply(); }

  String lastText() { return p.getString("last_text", ""); }
  long lastAt() { return p.getLong("last_at", 0); }
  void setLast(String t, long at) { p.edit().putString("last_text", t).putLong("last_at", at).apply(); }
}
