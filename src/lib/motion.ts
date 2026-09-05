/**
 * «حرکتِ کمتر» — یک جا، برای همه‌ی انیمیشن‌های جاوااسکریپتی.
 *
 * انیمیشن‌های CSS خودشان در `index.css` با یک قانونِ سراسری خفه می‌شوند، ولی
 * gsap و canvas از آن قانون بی‌خبرند و باید صریح بپرسند.
 *
 * هر بار پرسیده می‌شود نه یک بار در ماژول: کاربر می‌تواند وسطِ کار تنظیمِ
 * سیستم را عوض کند و آن‌وقت یک مقدارِ کش‌شده تا رفرشِ بعدی اشتباه می‌ماند.
 */
export function reducedMotion(): boolean {
  // خودِ `matchMedia` هم چک می‌شود، نه فقط `window`: این تابع وسطِ رندر صدا
  // زده می‌شود و در هر محیطی که آن را نداشته باشد (تست، وب‌ویوهای عجیب) یک
  // استثنا این‌جا یعنی صفحه‌ی سفید، نه فقط نبودنِ انیمیشن
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * جهتِ افقیِ صفحه: ۱ برای چپ‌به‌راست و ۱- برای راست‌به‌چپ.
 *
 * از `document.dir` می‌آید نه از استورِ زبان، چون هر چیزی که با پیکسل و
 * `translateX` کار می‌کند به جهتِ واقعیِ رندر کار دارد، نه به این‌که کاربر چه
 * زبانی انتخاب کرده.
 */
export function dirSign(): 1 | -1 {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl' ? -1 : 1
}
