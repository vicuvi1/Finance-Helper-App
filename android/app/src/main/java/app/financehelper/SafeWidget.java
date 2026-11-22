package app.financehelper;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.widget.RemoteViews;

/** Home-screen widget: Safe to spend today, and ＋ to add an expense. */
public class SafeWidget extends AppWidgetProvider {
  @Override
  public void onUpdate(Context ctx, AppWidgetManager m, int[] ids) {
    draw(ctx, m, ids);
    PendingResult done = goAsync();
    new Thread(() -> {
      try {
        String line = Capture.safeLine(ctx);
        if (line != null) Widget.fromLine(ctx, line);
        Capture.send(ctx, null); // anything waiting from when the phone was offline
      } finally {
        done.finish();
      }
    }).start();
  }

  static void refresh(Context ctx) {
    AppWidgetManager m = AppWidgetManager.getInstance(ctx);
    draw(ctx, m, m.getAppWidgetIds(new ComponentName(ctx, SafeWidget.class)));
  }

  private static void draw(Context ctx, AppWidgetManager m, int[] ids) {
    Store s = new Store(ctx);
    for (int id : ids) {
      RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget);
      String amount = s.widgetAmount();
      v.setTextViewText(R.id.w_amount, amount.isEmpty() ? "Open the app once" : amount);
      v.setTextViewText(R.id.w_note, s.widgetNote());
      v.setOnClickPendingIntent(R.id.w_root, open(ctx, "home", 10));
      v.setOnClickPendingIntent(R.id.w_add, open(ctx, "add-expense", 11));
      m.updateAppWidget(id, v);
    }
  }

  private static PendingIntent open(Context ctx, String where, int code) {
    Intent i = new Intent(ctx, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("fh://open/" + where));
    return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
  }
}
