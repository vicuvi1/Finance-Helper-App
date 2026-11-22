package app.financehelper;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The small Add window (from the quick settings tile): an amount and what for, like Quick add
 * ("120 lunch", "+500 salary", "45 taxi yesterday"). Saved through your server; kept and sent
 * later when there's no internet.
 */
public class QuickAddActivity extends Activity {
  @Override
  protected void onCreate(Bundle saved) {
    super.onCreate(saved);
    int pad = dp(18);
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(pad, pad, pad, pad);
    GradientDrawable bg = new GradientDrawable();
    bg.setColor(Color.parseColor("#161A22"));
    bg.setCornerRadius(dp(20));
    box.setBackground(bg);

    TextView title = new TextView(this);
    title.setText("Add a record");
    title.setTextColor(Color.parseColor("#F2EEE6"));
    title.setTextSize(18);
    box.addView(title);

    TextView hint = new TextView(this);
    hint.setText("An amount and what for: 120 lunch · +500 salary · 45 taxi yesterday");
    hint.setTextColor(Color.parseColor("#8B93A3"));
    hint.setTextSize(12);
    hint.setPadding(0, dp(4), 0, dp(10));
    box.addView(hint);

    EditText input = new EditText(this);
    input.setHint("120 lunch");
    input.setTextColor(Color.parseColor("#F2EEE6"));
    input.setHintTextColor(Color.parseColor("#5C6372"));
    input.setTextSize(20);
    input.setSingleLine(true);
    input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    input.setImeOptions(EditorInfo.IME_ACTION_DONE);
    box.addView(input, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

    LinearLayout row = new LinearLayout(this);
    row.setGravity(Gravity.END);
    row.setPadding(0, dp(12), 0, 0);
    Button cancel = new Button(this);
    cancel.setText("Cancel");
    cancel.setOnClickListener((v) -> finish());
    Button save = new Button(this);
    save.setText("Save");
    row.addView(cancel);
    row.addView(save);
    box.addView(row);
    setContentView(box);
    getWindow().setLayout((int) (getResources().getDisplayMetrics().widthPixels * 0.92), ViewGroup.LayoutParams.WRAP_CONTENT);
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
    input.requestFocus();

    Runnable go = () -> {
      String text = input.getText().toString().trim();
      if (!text.matches(".*\\d.*")) { Toast.makeText(this, "Start with an amount, like 120 lunch", Toast.LENGTH_SHORT).show(); return; }
      save.setEnabled(false);
      new Thread(() -> {
        String r = Capture.quick(this, text);
        runOnUiThread(() -> {
          Toast.makeText(this, r == null ? "No internet: saved on the phone, sent as soon as it's back" : r.split("\n")[0], Toast.LENGTH_LONG).show();
          finish();
        });
      }).start();
    };
    save.setOnClickListener((v) -> go.run());
    input.setOnEditorActionListener((v, id, e) -> { go.run(); return true; });
  }

  private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
