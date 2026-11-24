package app.financehelper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;

/**
 * Reads notifications (only after you allow it in Android's settings) and sends the ones from the
 * bank apps you picked to your server, which records the payment. Other apps' notifications are
 * looked at here only to offer them in the list ("looks like a payment"); nothing else leaves the phone.
 */
public class BankListener extends NotificationListenerService {
  @Override
  public void onNotificationPosted(StatusBarNotification sbn) {
    try {
      String pkg = sbn.getPackageName();
      if (pkg == null || pkg.equals(getPackageName())) return;
      Notification n = sbn.getNotification();
      if (n == null || (n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
      Bundle x = n.extras;
      CharSequence title = x.getCharSequence(Notification.EXTRA_TITLE);
      CharSequence big = x.getCharSequence(Notification.EXTRA_BIG_TEXT);
      CharSequence body = big != null ? big : x.getCharSequence(Notification.EXTRA_TEXT);
      String text = ((title != null ? title + ". " : "") + (body != null ? body : "")).trim();
      if (!Payments.looksLikePayment(text)) return;
      Store s = new Store(this);
      // The same notification shown again (updated, re-posted) within 2 minutes: once.
      long now = System.currentTimeMillis();
      if (text.equals(s.lastText()) && now - s.lastAt() < 120000) return;
      s.setLast(text, now);
      JSONObject apps = s.apps();
      JSONObject a = apps.optJSONObject(pkg);
      boolean isNew = a == null;
      if (a == null) a = new JSONObject();
      a.put("label", label(pkg));
      a.put("example", text.length() > 120 ? text.substring(0, 120) + "…" : text);
      a.put("seen", now);
      apps.put(pkg, a);
      s.saveApps(apps);
      if (a.optBoolean("on")) {
        if (s.askFirst()) {
          // Ask first: "💳 120 MDL · Linella — Food · maib Visa, save it?"
          String id = Long.toString(now, 36) + Integer.toString(Math.abs(text.hashCode()), 36);
          new Thread(() -> {
            org.json.JSONObject pv = Capture.preview(this, text, now);
            if (pv != null && !pv.optBoolean("payment", false)) return; // not a payment after all (a code, declined)
            Ask.show(this, id, text, now, pv);
          }).start();
        } else {
          new Thread(() -> Capture.send(this, text)).start();
        }
      } else if (isNew) {
        ask(pkg, a.optString("label"));
      }
    } catch (Exception ignored) {
      // Never crash the listener: Android would stop it.
    }
  }

  private String label(String pkg) {
    try {
      PackageManager pm = getPackageManager();
      return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
    } catch (Exception e) {
      return pkg;
    }
  }

  /** "Payment seen from maib: record them automatically?" (once per app). */
  private void ask(String pkg, String name) {
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (nm == null) return;
    nm.createNotificationChannel(new NotificationChannel("fh", "Finance Helper", NotificationManager.IMPORTANCE_DEFAULT));
    Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("fh://open/phone-pay"));
    PendingIntent pi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    Notification note = new Notification.Builder(this, "fh")
      .setSmallIcon(android.R.drawable.ic_dialog_info)
      .setContentTitle("Payment seen from " + name)
      .setContentText("Record payments from " + name + " automatically? Tap to choose.")
      .setContentIntent(pi)
      .setAutoCancel(true)
      .build();
    nm.notify(pkg.hashCode(), note);
  }
}
