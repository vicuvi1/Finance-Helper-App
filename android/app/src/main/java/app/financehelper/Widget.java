package app.financehelper;

import android.content.Context;

/** Turns a line like "Safe to spend today: 412 MDL" into the widget's text. */
final class Widget {
  private Widget() {}

  static void fromLine(Context ctx, String text) {
    if (text == null || text.isEmpty()) return;
    String amount = null;
    String note = "";
    for (String line : text.split("\n")) {
      int i = line.indexOf("Safe to spend today:");
      if (i >= 0) amount = line.substring(i + 20).trim();
      else if (line.startsWith("✅")) note = "Last: " + line.substring(1).trim();
    }
    Store s = new Store(ctx);
    if (amount == null) amount = s.widgetAmount();
    s.setWidget(amount, note.isEmpty() ? s.widgetNote() : note);
    SafeWidget.refresh(ctx);
  }
}
