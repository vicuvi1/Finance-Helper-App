package app.financehelper;

import java.util.regex.Pattern;

/** A quick look at a notification: could it be a payment? (The server reads it properly.) */
final class Payments {
  private Payments() {}
  private static final Pattern MONEY = Pattern.compile("(?i)(\\d[\\d\\s.,]*\\s*(MDL|LEI|USD|EUR|RON|RUB|UAH|GBP|\\$|€))|((MDL|LEI|USD|EUR|RON|\\$|€)\\s*\\d)");
  private static final Pattern NOT = Pattern.compile("(?i)\\bcod\\b|codul|\\bcode\\b|parol|password|\\bOTP\\b");

  static boolean looksLikePayment(String text) {
    return text != null && text.length() < 1500 && MONEY.matcher(text).find() && !NOT.matcher(text).find();
  }
}
