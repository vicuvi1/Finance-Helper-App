package app.financehelper;

import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.TileService;

/** A button in Android's quick settings (swipe down twice): opens the small Add window. */
public class QuickTile extends TileService {
  @Override
  public void onClick() {
    Intent i = new Intent(this, QuickAddActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
    if (Build.VERSION.SDK_INT >= 34) {
      startActivityAndCollapse(PendingIntent.getActivity(this, 20, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
    } else {
      startActivityAndCollapse(i);
    }
  }
}
