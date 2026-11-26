package app.financehelper;

import android.app.Application;
import android.content.Context;
import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * If the app ever stops by itself, the reason is kept on the phone and shown the next time you open
 * it (MainActivity), so it can be fixed instead of guessed.
 */
public class App extends Application {
  @Override
  public void onCreate() {
    super.onCreate();
    final Thread.UncaughtExceptionHandler before = Thread.getDefaultUncaughtExceptionHandler();
    Thread.setDefaultUncaughtExceptionHandler((t, e) -> {
      try { keep(this, e, t.getName()); } catch (Throwable ignored) { /* nothing more to do */ }
      if (before != null) before.uncaughtException(t, e);
    });
  }

  static void keep(Context ctx, Throwable e, String where) {
    StringWriter w = new StringWriter();
    e.printStackTrace(new PrintWriter(w));
    String v = UpdateCheck.installed(ctx);
    String text = "Finance Helper " + v + " · Android " + android.os.Build.VERSION.RELEASE + " (" + android.os.Build.VERSION.SDK_INT + ") · "
      + android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL + " · " + where + "\n\n" + w;
    if (text.length() > 6000) text = text.substring(0, 6000);
    // commit(), not apply(): the app is about to stop.
    ctx.getSharedPreferences("fh", Context.MODE_PRIVATE).edit().putString("crash", text).commit();
  }
}
