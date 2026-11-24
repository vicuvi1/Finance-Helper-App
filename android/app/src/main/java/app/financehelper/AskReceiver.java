package app.financehelper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;
import org.json.JSONObject;

/** Save or Ignore from the payment notification. */
public class AskReceiver extends BroadcastReceiver {
  static final String SAVE = "app.financehelper.SAVE";
  static final String IGNORE = "app.financehelper.IGNORE";

  @Override
  public void onReceive(Context ctx, Intent intent) {
    String id = intent.getStringExtra("id");
    if (id == null) return;
    if (IGNORE.equals(intent.getAction())) { Ask.done(ctx, id); return; }
    JSONObject p = new Store(ctx).pending().optJSONObject(id);
    if (p == null) { Ask.done(ctx, id); return; }
    PendingResult res = goAsync();
    new Thread(() -> {
      try {
        JSONObject body = new JSONObject().put("text", p.optString("text")).put("at", p.optLong("at")).put("confirm", true);
        JSONObject pv = p.optJSONObject("preview");
        if (pv != null) body.put("category", pv.optString("category")).put("account", pv.optString("account"));
        String r = Capture.confirm(ctx, body);
        Ask.done(ctx, id);
        String msg = r == null ? "Saved on the phone: sent as soon as there's internet" : r.split("\n")[0];
        new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> Toast.makeText(ctx, msg, Toast.LENGTH_SHORT).show());
      } catch (Exception ignored) {
        // Left in the notification: try again.
      } finally {
        res.finish();
      }
    }).start();
  }
}
