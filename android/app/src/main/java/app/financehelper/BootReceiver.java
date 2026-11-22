package app.financehelper;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** After the phone restarts: plan the hourly alert check again. */
public class BootReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context ctx, Intent i) {
    if (Intent.ACTION_BOOT_COMPLETED.equals(i.getAction())) AlertJob.schedule(ctx);
  }
}
