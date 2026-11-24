package app.financehelper;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * About once an hour (when there's internet): asks your server what's worth knowing (a bill due
 * tomorrow, a budget at 80%, money running low) and shows each one once as a phone notification.
 * Also sends payments waiting from when the phone was offline. Off: the web app's phone sheet.
 */
public class AlertJob extends JobService {
  static final int ID = 4401;

  static void schedule(Context ctx) {
    JobScheduler js = ctx.getSystemService(JobScheduler.class);
    if (js == null) return;
    if (!new Store(ctx).alertsOn()) { js.cancel(ID); return; }
    for (JobInfo j : js.getAllPendingJobs()) if (j.getId() == ID) return; // already planned
    js.schedule(new JobInfo.Builder(ID, new ComponentName(ctx, AlertJob.class))
      .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
      .setPeriodic(60 * 60 * 1000L)
      .setPersisted(true)
      .build());
  }

  @Override
  public boolean onStartJob(JobParameters params) {
    new Thread(() -> {
      try {
        Capture.send(this, null);
        UpdateCheck.run(this, false);
        String line = Capture.safeLine(this);
        if (line != null) Widget.fromLine(this, line);
        Store s = new Store(this);
        JSONArray list = s.alertsOn() ? Capture.alerts(this) : null;
        if (list != null) show(list, s);
      } catch (Exception ignored) {
        // Next hour.
      } finally {
        jobFinished(params, false);
      }
    }).start();
    return true;
  }

  @Override public boolean onStopJob(JobParameters params) { return true; }

  private void show(JSONArray list, Store s) throws Exception {
    NotificationManager nm = getSystemService(NotificationManager.class);
    if (nm == null) return;
    nm.createNotificationChannel(new NotificationChannel("alerts", "Money alerts", NotificationManager.IMPORTANCE_DEFAULT));
    JSONArray seen = s.seenAlerts();
    java.util.HashSet<String> had = new java.util.HashSet<>();
    for (int i = 0; i < seen.length(); i++) had.add(seen.optString(i));
    for (int i = 0; i < list.length(); i++) {
      JSONObject a = list.getJSONObject(i);
      String id = a.optString("id");
      if (id.isEmpty() || had.contains(id)) continue;
      Intent open = new Intent(this, MainActivity.class).setAction(Intent.ACTION_VIEW).setData(Uri.parse("fh://open/home"));
      PendingIntent pi = PendingIntent.getActivity(this, 30, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
      Notification n = new Notification.Builder(this, "alerts")
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(a.optString("title"))
        .setContentText(a.optString("body"))
        .setStyle(new Notification.BigTextStyle().bigText(a.optString("body")))
        .setContentIntent(pi)
        .setAutoCancel(true)
        .build();
      nm.notify(id.hashCode(), n);
      seen.put(id);
    }
    s.saveSeenAlerts(seen);
  }
}
