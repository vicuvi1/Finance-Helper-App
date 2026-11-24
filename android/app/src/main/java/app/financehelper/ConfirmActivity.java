package app.financehelper;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.GridLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * "Change" from the payment notification: the payment filled in, your 8 most used categories as
 * buttons, the card, the amount and a note. Save keeps exactly that.
 */
public class ConfirmActivity extends Activity {
  private String chosenCat = "";
  private final java.util.List<Button> catButtons = new java.util.ArrayList<>();

  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    String id = getIntent().getStringExtra("id");
    JSONObject p = id == null ? null : new Store(this).pending().optJSONObject(id);
    JSONObject pv = p == null ? null : p.optJSONObject("preview");
    if (p == null || pv == null) { Toast.makeText(this, "This payment was already handled", Toast.LENGTH_SHORT).show(); finish(); return; }
    chosenCat = pv.optString("category");

    int pad = dp(18);
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(pad, pad, pad, pad);
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(Color.parseColor("#161A22"));
    bg.setCornerRadius(dp(20));
    box.setBackground(bg);

    box.addView(text("Save this payment?", 18, "#F2EEE6"));

    LinearLayout row = new LinearLayout(this);
    row.setPadding(0, dp(10), 0, 0);
    EditText amount = field(Ask.money(pv.optLong("amount"), "").trim(), InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
    TextView cur = text(pv.optString("currency"), 16, "#8B93A3");
    cur.setPadding(dp(8), 0, 0, 0);
    row.addView(amount, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    row.addView(cur);
    box.addView(row);

    EditText note = field(pv.optString("note"), InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    box.addView(note);

    TextView catLabel = text("Category", 12, "#8B93A3");
    catLabel.setPadding(0, dp(10), 0, dp(4));
    box.addView(catLabel);
    GridLayout grid = new GridLayout(this);
    grid.setColumnCount(2);
    JSONArray cats = pv.optJSONArray("categories");
    for (int i = 0; cats != null && i < cats.length(); i++) {
      JSONObject c = cats.optJSONObject(i);
      Button b = new Button(this);
      b.setAllCaps(false);
      b.setText((c.optString("emoji").isEmpty() ? "" : c.optString("emoji") + " ") + c.optString("name"));
      b.setTag(c.optString("id"));
      b.setOnClickListener((v) -> { chosenCat = (String) v.getTag(); paintCats(); });
      GridLayout.LayoutParams lp = new GridLayout.LayoutParams();
      lp.width = 0;
      lp.columnSpec = GridLayout.spec(GridLayout.UNDEFINED, 1f);
      grid.addView(b, lp);
      catButtons.add(b);
    }
    box.addView(grid);
    paintCats();

    TextView accLabel = text("Card", 12, "#8B93A3");
    accLabel.setPadding(0, dp(10), 0, dp(4));
    box.addView(accLabel);
    Spinner acc = new Spinner(this);
    JSONArray accs = pv.optJSONArray("accounts");
    java.util.List<String> names = new java.util.ArrayList<>();
    java.util.List<String> ids = new java.util.ArrayList<>();
    int sel = 0;
    for (int i = 0; accs != null && i < accs.length(); i++) {
      JSONObject a = accs.optJSONObject(i);
      names.add(a.optString("name"));
      ids.add(a.optString("id"));
      if (a.optString("id").equals(pv.optString("account"))) sel = i;
    }
    acc.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, names));
    if (!names.isEmpty()) acc.setSelection(sel);
    box.addView(acc);

    LinearLayout btns = new LinearLayout(this);
    btns.setGravity(Gravity.END);
    btns.setPadding(0, dp(12), 0, 0);
    Button ignore = new Button(this);
    ignore.setText("Ignore");
    ignore.setOnClickListener((v) -> { Ask.done(this, id); finish(); });
    Button save = new Button(this);
    save.setText("Save");
    btns.addView(ignore);
    btns.addView(save);
    box.addView(btns);

    ScrollView scroll = new ScrollView(this);
    scroll.addView(box);
    setContentView(scroll);
    getWindow().setLayout((int) (getResources().getDisplayMetrics().widthPixels * 0.94), ViewGroup.LayoutParams.WRAP_CONTENT);

    save.setOnClickListener((v) -> {
      save.setEnabled(false);
      try {
        JSONObject body = new JSONObject().put("text", p.optString("text")).put("at", p.optLong("at")).put("confirm", true)
          .put("category", chosenCat).put("note", note.getText().toString().trim());
        if (!ids.isEmpty()) body.put("account", ids.get(Math.max(0, acc.getSelectedItemPosition())));
        long bani = parseBani(amount.getText().toString());
        if (bani > 0 && bani != pv.optLong("amount")) body.put("amount_set", bani);
        new Thread(() -> {
          String r = Capture.confirm(this, body);
          Ask.done(this, id);
          runOnUiThread(() -> { Toast.makeText(this, r == null ? "Saved on the phone: sent as soon as there's internet" : r.split("\n")[0], Toast.LENGTH_SHORT).show(); finish(); });
        }).start();
      } catch (Exception e) {
        save.setEnabled(true);
      }
    });
  }

  private void paintCats() {
    for (Button b : catButtons) {
      boolean on = chosenCat.equals(b.getTag());
      GradientDrawable d = new GradientDrawable();
      d.setCornerRadius(dp(12));
      d.setColor(Color.parseColor(on ? "#E3B95F" : "#1C212B"));
      b.setBackground(d);
      b.setTextColor(Color.parseColor(on ? "#0B0D12" : "#F2EEE6"));
    }
  }

  /** "120,50" / "1 200" / "120.5" → bani. */
  static long parseBani(String s) {
    String t = s.replace(" ", "").replace(" ", "").replace(',', '.');
    try { return Math.round(Double.parseDouble(t) * 100); } catch (Exception e) { return 0; }
  }

  private TextView text(String s, int size, String color) {
    TextView t = new TextView(this);
    t.setText(s);
    t.setTextSize(size);
    t.setTextColor(Color.parseColor(color));
    return t;
  }

  private EditText field(String value, int type) {
    EditText e = new EditText(this);
    e.setText(value);
    e.setInputType(type);
    e.setTextColor(Color.parseColor("#F2EEE6"));
    e.setSingleLine(true);
    return e;
  }

  private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
