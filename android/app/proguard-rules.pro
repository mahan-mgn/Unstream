# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the source file attribute, uncomment this to give the source a
# new name.
#-renamesourcefileattribute SourceFile

# ---------------------------------------------------------------------------
# آنوتیشن‌هایِ رانتایمِ کاپاسیتور باید زنده بمانند.
#
# کاپاسیتور پلاگین‌ها را با بازتاب کشف می‌کند: `PluginHandle` هنگامِ ساختن،
# `@CapacitorPlugin` را با `Class.getAnnotation` می‌خواند و همان شیءِ آنوتیشن
# را در فیلدِ `pluginAnnotation` نگه می‌دارد. `Bridge.getPermissionStates` بعداً
# روی *همان فیلد* حلقه می‌زند (`annotation.permissions()`).
#
# R8 هیچِ استفاده‌ی مستقیمی از کلاسِ آنوتیشن نمی‌بیند (فقط از راهِ بازتاب به آن
# دست می‌زنند)، پس در بیلدِ ریلیز آن را دور می‌ریزد. نتیجه: فیلدِ
# `pluginAnnotation` تهی می‌ماند و اولین `getPermissionState` — که در این اپ
# دقیقاً لحظه‌ی «پخشِ اولین آهنگ» اجرا می‌شود (درخواستِ اجازه‌ی نوتیفیکیشن) —
# با `NullPointerException` روی نخِ `CapacitorPlugins` کلِ اپ را می‌اندازد.
# بیلدِ دیباگ نمی‌ترکد، چون R8 در کار نیست؛ به‌همین‌دلیل این باگ در تستِ محلی
# دیده نشد و فقط در APKِ ریلیز ظاهر شد.
#
# قواعدِ خودِ کاپاسیتور (`-keep public class * extends com.getcapacitor.Plugin`)
# عضوهایِ کلاسِ پلاگین را نگه می‌دارد ولی *نوعِ آنوتیشن* را نه — پس این سه خط
# لازم است، نه یدکِ قواعدِ کتابخانه.
# ---------------------------------------------------------------------------
-keepattributes RuntimeVisibleAnnotations,RuntimeInvisibleAnnotations,AnnotationDefault
-keep @interface com.getcapacitor.annotation.*
-keep class com.getcapacitor.annotation.** { *; }
