package app.unstream.client;

import android.content.Intent;
import android.util.DisplayMetrics;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * حاشیه‌های امنِ سیستم (نوار وضعیت، نوار ناوبری، ناچ).
 *
 * چرا دستی؟ چون `env(safe-area-inset-*)` داخل WebViewِ اندروید قابل‌اتکا نیست:
 * بسته به نسخه‌ی WebView، حالتِ لبه‌تاـلبه و حالتِ ناوبری (دکمه‌ای یا ژستی)
 * گاهی صفر برمی‌گرداند. نتیجه‌اش هدری بود که زیرِ ساعت می‌رفت و نوارِ پخشی که
 * روی نوارِ ناوبری می‌افتاد.
 *
 * اینجا همان مقدارها را از خودِ سیستم می‌گیریم و JS آن‌ها را روی همان
 * متغیرهای CSS (`--safe-t` و برادرانش) می‌نشاند. روی وب هیچ‌کدام اجرا نمی‌شود
 * و `env()` سرِ جایش می‌ماند.
 */
@CapacitorPlugin(name = "Shell")
public class ShellPlugin extends Plugin {

    /**
     * متنی که با «اشتراک‌گذاری» از اپِ دیگری آمده و هنوز به JS تحویل نشده.
     *
     * لازم است چون اپ ممکن است *به‌خاطرِ همین اشتراک‌گذاری* تازه بالا آمده
     * باشد: آن‌وقت اینتنت پیش از آماده‌شدنِ رابط رسیده و هیچ شنونده‌ای نبوده.
     * JS بعد از سوار شدن با `takeSharedText` می‌آید و برش می‌دارد.
     */
    private String pendingShare;

    @Override
    public void load() {
        View root = getBridge().getWebView();

        readShare(getActivity().getIntent());

        /*
         * حاشیه‌ها ثابت نیستند: چرخاندن گوشی، باز شدنِ کیبورد، و عوض‌شدنِ حالتِ
         * ناوبری همه عوضشان می‌کنند. بدون این شنونده، مقدارِ لحظه‌ی باز شدنِ اپ
         * برای همیشه می‌ماند.
         */
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, insets) -> {
            notifyListeners("insets", read(insets));
            return insets;
        });
    }

    @PluginMethod
    public void insets(PluginCall call) {
        View root = getBridge().getWebView();
        WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
        if (insets == null) {
            // هنوز به پنجره وصل نشده — JS همان `env()` را نگه می‌دارد
            JSObject empty = new JSObject();
            empty.put("ready", false);
            call.resolve(empty);
            return;
        }
        call.resolve(read(insets));
    }

    /**
     * لینکِ اشتراک‌گذاری‌شده را می‌گیرد و پاکش می‌کند.
     *
     * «گرفتن و پاک‌کردن» عمدی است: بدونش هر بار که کاربر اپ را از پس‌زمینه
     * برمی‌گرداند، همان لینکِ قدیمی دوباره باز می‌شد.
     */
    @PluginMethod
    public void takeSharedText(PluginCall call) {
        JSObject result = new JSObject();
        result.put("text", pendingShare == null ? "" : pendingShare);
        pendingShare = null;
        call.resolve(result);
    }

    /** اپ باز بود و کاربر از اپِ دیگری چیزی به آن اشتراک گذاشت */
    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        readShare(intent);
        if (pendingShare == null) return;

        JSObject event = new JSObject();
        event.put("text", pendingShare);
        pendingShare = null;
        notifyListeners("shared", event);
    }

    private void readShare(Intent intent) {
        if (intent == null) return;
        if (!Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.trim().isEmpty()) return;
        pendingShare = text.trim();
    }

    private JSObject read(WindowInsetsCompat insets) {
        /*
         * `systemBars` نوار وضعیت و نوار ناوبری را می‌دهد و `displayCutout` ناچ
         * را. جمعشان لازم است نه یکی‌شان: روی گوشیِ ناچ‌دار در حالتِ افقی، ناچ
         * از کنار می‌آید جایی که نوار وضعیت اصلاً نیست.
         *
         * کیبورد (`ime`) عمداً بیرون است: با `interactive-widget=resizes-content`
         * خودِ WebView کوچک می‌شود و اضافه‌کردنش حاشیه را دوبار حساب می‌کرد.
         */
        Insets value = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());

        DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
        float density = metrics.density <= 0 ? 1f : metrics.density;

        JSObject result = new JSObject();
        result.put("ready", true);
        // CSS با پیکسلِ منطقی کار می‌کند، اندروید با پیکسلِ فیزیکی
        result.put("top", value.top / density);
        result.put("bottom", value.bottom / density);
        result.put("left", value.left / density);
        result.put("right", value.right / density);
        return result;
    }
}
