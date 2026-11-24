package app.financehelper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

/**
 * "💳 120 MDL · Linella — Food · maib Visa, save it?" with Save / Change / Ignore.
 * The answer is handled by AskReceiver (Save, Ignore) or ConfirmActivity (Change).
 */
final class Ask {
  private Ask() {}
  static final String CHANNEL = "ask";

  static int notifId(String id) { return ("ask" + id).hashCode(); }

  /** Remembers the payment and shows the question. `preview`: the server's answer, or null when offline. */
  static void show(Context ctx, String id, String text, long at, JSONObject preview) {
    try {
      Store s = new Store(ctx);
      JSONObject pend = s.pending();
      pend.put(id, new JSONObject().put("text", text).put("at", at).put("preview", preview == null ? JSONObject.NULL : preview));
      // Keep at most 30 waiting answers.
      while (pend.length() > 30) pend.remove(pend.keys().next());
      s.savePending(pend);

      NotificationManager nm = ctx.getSystemService(NotificationManager.class);
      if (nm == null) return;
      nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Payments to save", NotificationManager.IMPORTANCE_HIGH));
      String title;
      String body;
      if (preview != null) {
        String amount = money(preview.optLong("amount"), preview.optString("currency", ""));
        title = "💳 " + (preview.optString("kind").equals("income") ? "+" : "") + amount + " · " + preview.optString("note");
        body = preview.optString("categoryName") + (preview.optString("accountName").isEmpty() ? "" : " · " + preview.optString("accountName")) + " — save it?";
      } else {
        title = "💳 Payment seen";
        body = (text.length() > 90 ? text.substring(0, 90) + "…" : text) + " — save it when you're online?";
      }
      Notification.Builder b = new Notification.Builder(ctx, CHANNEL)
        .setSmallIcon(android.R.drawable.ic_menu_save)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(new Notification.BigTextStyle().bigText(body))
        .setAutoCancel(false)
        .setOngoing(false)
        .setContentIntent(change(ctx, id))
        .addAction(new Notification.Action.Builder(null, "Save", receiver(ctx, id, AskReceiver.SAVE)).build());
      if (preview != null) b.addAction(new Notification.Action.Builder(null, "Change", change(ctx, id)).build());
      b.addAction(new Notification.Action.Builder(null, "Ignore", receiver(ctx, id, AskReceiver.IGNORE)).build());
      liveUpdate(b, preview == null ? "💳" : money(preview.optLong("amount"), ""));
      nm.notify(notifId(id), b.build());
    } catch (Exception ignored) {
      // Never crash the listener.
    }
  }

  /**
   * Android 16+ "live update": a chip in the status bar with the amount, and on Samsung (One UI 8)
   * the Now Bar on the lock screen — like Apple's Dynamic Island. It stays until you answer.
   * Called by name so the app still builds for and runs on older Androids (there it's a normal
   * pop-up notification with the same buttons).
   */
  static void liveUpdate(Notification.Builder b, String chip) {
    if (android.os.Build.VERSION.SDK_INT < 36) return;
    try {
      b.setOngoing(true);
      b.setColorized(false);
      Notification.Builder.class.getMethod("setRequestPromotedOngoing", boolean.class).invoke(b, true);
      Notification.Builder.class.getMethod("setShortCriticalText", String.class).invoke(b, chip.trim());
    } catch (Throwable ignored) {
      // Not on this phone: the pop-up notification is enough.
    }
  }

  static void done(Context ctx, String id) {
    Store s = new Store(ctx);
    JSONObject pend = s.pending();
    pend.remove(id);
    s.savePending(pend);
    NotificationManager nm = ctx.getSystemService(NotificationManager.class);
    if (nm != null) nm.cancel(notifId(id));
  }

  private static PendingIntent receiver(Context ctx, String id, String action) {
    Intent i = new Intent(ctx, AskReceiver.class).setAction(action).putExtra("id", id);
    return PendingIntent.getBroadcast(ctx, (action + id).hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  private static PendingIntent change(Context ctx, String id) {
    Intent i = new Intent(ctx, ConfirmActivity.class).putExtra("id", id).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    return PendingIntent.getActivity(ctx, ("change" + id).hashCode(), i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }

  /** 12050 → "120,50 MDL" (whole amounts without the ,00). */
  static String money(long bani, String cur) {
    long lei = bani / 100;
    long rest = Math.abs(bani % 100);
    String whole = String.format(java.util.Locale.ROOT, "%,d", lei).replace(',', ' ');
    return whole + (rest == 0 ? "" : "," + String.format(java.util.Locale.ROOT, "%02d", rest)) + (cur.isEmpty() ? "" : " " + cur);
  }
}
