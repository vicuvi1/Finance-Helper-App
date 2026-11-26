package app.financehelper;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** The web app in a full-screen window, on your own server. Links elsewhere open in the browser. */
public class MainActivity extends Activity {
  private WebView web;
  private Bridge bridge;
  private ValueCallback<Uri[]> pickFile;

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    try { BuildConfigHolder.VERSION = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception ignored) { /* unknown */ }
    // Stopped by itself last time? Show why (plain Android screen, no web page) before anything else.
    String crash = getSharedPreferences("fh", MODE_PRIVATE).getString("crash", null);
    if (crash != null) { showCrash(crash, saved); return; }
    start(saved);
  }

  private void start(Bundle saved) {
    try {
      openWeb(saved);
    } catch (Throwable e) {
      // No WebView on this phone (being updated, or turned off): say so instead of closing.
      App.keep(this, e, "opening the page");
      showCrash(getSharedPreferences("fh", MODE_PRIVATE).getString("crash", ""), null);
      return;
    }
    try {
      if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
      }
    } catch (Throwable ignored) { /* asked again later */ }
    try { AlertJob.schedule(this); } catch (Throwable e) { App.keep(this, e, "planning alerts (ignored)"); clearCrash(); }
    background(() -> Capture.send(this, null)); // anything waiting from when the phone was offline
    background(() -> UpdateCheck.run(this, false));
  }

  /** Work off the screen that can never take the app down with it. */
  private void background(Runnable r) {
    new Thread(() -> { try { r.run(); } catch (Throwable ignored) { /* tried again next time */ } }).start();
  }

  private void clearCrash() { getSharedPreferences("fh", MODE_PRIVATE).edit().remove("crash").apply(); }

  /** "Finance Helper stopped last time" with the reason (selectable), Copy and Open the app. */
  private void showCrash(String text, Bundle saved) {
    android.widget.ScrollView sv = new android.widget.ScrollView(this);
    android.widget.LinearLayout box = new android.widget.LinearLayout(this);
    box.setOrientation(android.widget.LinearLayout.VERTICAL);
    int pad = (int) (22 * getResources().getDisplayMetrics().density);
    box.setPadding(pad, pad * 2, pad, pad);
    sv.addView(box);
    android.widget.TextView h = new android.widget.TextView(this);
    h.setText("Finance Helper stopped last time");
    h.setTextSize(22);
    h.setTextColor(0xFFF2EEE6);
    box.addView(h);
    android.widget.TextView p = new android.widget.TextView(this);
    p.setText("Take a screenshot of this (or tap Copy) and send it, so it can be fixed. Then tap Open the app.");
    p.setTextColor(0xFF8B93A3);
    p.setPadding(0, pad / 2, 0, pad / 2);
    box.addView(p);
    android.widget.Button open = new android.widget.Button(this);
    open.setText("Open the app");
    open.setOnClickListener(v -> { clearCrash(); recreate(); });
    box.addView(open);
    android.widget.Button copy = new android.widget.Button(this);
    copy.setText("Copy");
    copy.setOnClickListener(v -> {
      try {
        android.content.ClipboardManager cm = getSystemService(android.content.ClipboardManager.class);
        cm.setPrimaryClip(android.content.ClipData.newPlainText("Finance Helper", text));
        android.widget.Toast.makeText(this, "Copied", android.widget.Toast.LENGTH_SHORT).show();
      } catch (Throwable ignored) { /* screenshot instead */ }
    });
    box.addView(copy);
    android.widget.TextView t = new android.widget.TextView(this);
    t.setText(text);
    t.setTextSize(11);
    t.setTextColor(0xFFC3C8D2);
    t.setTextIsSelectable(true);
    t.setPadding(0, pad / 2, 0, 0);
    box.addView(t);
    setContentView(sv);
  }

  private void openWeb(Bundle saved) {
    web = new WebView(this);
    setContentView(web);
    WebSettings ws = web.getSettings();
    ws.setJavaScriptEnabled(true);
    ws.setDomStorageEnabled(true);
    ws.setDatabaseEnabled(true);
    ws.setUserAgentString(ws.getUserAgentString() + " FinanceHelperAndroid/" + BuildConfigHolder.VERSION);
    bridge = new Bridge(this);
    web.addJavascriptInterface(bridge, "FHAndroid");
    final String host = Uri.parse(new Store(this).server()).getHost();
    web.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        Uri u = r.getUrl();
        if (host != null && host.equals(u.getHost())) return false;
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { /* no app for it */ }
        return true;
      }
      @Override public void onPageStarted(WebView v, String url, Bitmap icon) { bridge.pageUrl = url; }
      // No internet on the very first start (later starts open from the saved copy): a plain page with Try again.
      @Override public void onReceivedError(WebView v, android.webkit.WebResourceRequest r, android.webkit.WebResourceError e) {
        if (!r.isForMainFrame()) return;
        String retry = new Store(MainActivity.this).server() + "/";
        v.loadDataWithBaseURL(null, "<html><body style='margin:0;background:#0b0d12;color:#eceef2;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center'><div style='padding:24px'><h2 style='font-weight:600'>No internet</h2><p style='color:#8b93a3;line-height:1.5'>Finance Helper opens as soon as you're online. Payments from your bank are still caught and sent later.</p><p><a href='" + retry + "' style='display:inline-block;margin-top:12px;padding:12px 22px;border-radius:12px;background:#e3b95f;color:#0b0d12;text-decoration:none;font-weight:600'>Try again</a></p></div></body></html>", "text/html", "utf-8", null);
      }
      @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) { bridge.pageUrl = url; }
      // The page's own process stopped (low memory, a WebView update). Without this Android closes
      // the whole app; instead, start a fresh page.
      @Override public boolean onRenderProcessGone(WebView v, android.webkit.RenderProcessGoneDetail d) {
        if (web == v) {
          try { ((android.view.ViewGroup) v.getParent()).removeView(v); } catch (Throwable ignored) { /* not attached */ }
          try { v.destroy(); } catch (Throwable ignored) { /* already gone */ }
          web = null;
          try { openWeb(null); } catch (Throwable e) { App.keep(MainActivity.this, e, "reopening the page"); recreate(); }
        }
        return true;
      }
    });
    web.setWebChromeClient(new WebChromeClient() {
      // Bank statement import and backups: the file picker.
      @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
        if (pickFile != null) pickFile.onReceiveValue(null);
        pickFile = cb;
        try { startActivityForResult(p.createIntent(), 7); } catch (Exception e) { pickFile = null; return false; }
        return true;
      }
    });
    if (saved != null) web.restoreState(saved); else web.loadUrl(urlFor(getIntent()));
  }

  /** fh://open/add-expense → https://server/#add-expense */
  private String urlFor(Intent i) {
    String base = new Store(this).server() + "/";
    Uri d = i == null ? null : i.getData();
    if (d == null || !"fh".equals(d.getScheme())) return base;
    String where = d.getLastPathSegment();
    return where == null || where.equals("home") ? base : base + "#" + where;
  }

  @Override
  protected void onNewIntent(Intent i) {
    super.onNewIntent(i);
    Uri d = i.getData();
    if (web != null && d != null && "fh".equals(d.getScheme())) {
      String where = d.getLastPathSegment();
      web.evaluateJavascript("location.hash = '" + (where == null || where.equals("home") ? "" : where.replaceAll("[^a-z-]", "")) + "'", null);
    }
  }

  @Override
  protected void onActivityResult(int req, int res, Intent data) {
    super.onActivityResult(req, res, data);
    if (req == 7 && pickFile != null) {
      pickFile.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
      pickFile = null;
    }
  }

  // In the background the page sleeps: no timers, no sync checks, no battery. Payments are still
  // caught by BankListener (Android's own notification listener), and saved on your server.
  @Override
  protected void onPause() {
    super.onPause();
    if (web != null) { web.onPause(); web.pauseTimers(); }
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) {
      web.onResume();
      web.resumeTimers();
      // Back in the app: catch up at once (the page syncs when it becomes visible).
      web.evaluateJavascript("window.dispatchEvent(new Event('focus'))", null);
    }
  }

  @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); if (web != null) web.saveState(out); }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
}
