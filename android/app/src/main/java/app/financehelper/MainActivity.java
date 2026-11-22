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
      @Override public void doUpdateVisitedHistory(WebView v, String url, boolean reload) { bridge.pageUrl = url; }
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
    if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
    }
    new Thread(() -> Capture.send(this, null)).start(); // anything waiting from when the phone was offline
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
    if (d != null && "fh".equals(d.getScheme())) {
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

  @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

  @Override
  public void onBackPressed() {
    if (web.canGoBack()) web.goBack(); else super.onBackPressed();
  }
}
