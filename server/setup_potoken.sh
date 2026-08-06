#!/usr/bin/env bash
# سرور PO Token را کلون، پچ و بیلد می‌کند.
# یوتیوب بدون این، لیست فرمت خالی برمی‌گرداند.
#
#   bash server/setup_potoken.sh
#
# نسخه‌ی سرور باید با پلاگین پایتون (bgutil-ytdlp-pot-provider) یکی باشد.
set -euo pipefail

VERSION="1.3.1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$HERE/vendor/bgutil-ytdlp-pot-provider"

installed=$("$HERE/.venv/Scripts/pip" show bgutil-ytdlp-pot-provider 2>/dev/null \
  | awk '/^Version:/{print $2}' || true)
if [ -n "$installed" ] && [ "$installed" != "$VERSION" ]; then
  echo "هشدار: پلاگین پایتون $installed است ولی این اسکریپت سرور $VERSION را می‌سازد."
  echo "نسخه‌ها باید یکی باشند. VERSION را در این فایل عوض کن."
  exit 1
fi

if [ ! -d "$DEST" ]; then
  echo "==> کلون کردن نسخه‌ی $VERSION"
  mkdir -p "$HERE/vendor"
  git clone --depth 1 --branch "$VERSION" \
    https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git "$DEST"
fi

echo "==> اعمال پچ keepAlive"
# asDispatcher برای هر درخواست یک https.Agent بدون keepAlive می‌سازد و اتصال تازه
# به www.google.com روی بعضی شبکه‌ها ECONNRESET می‌گیرد. با keepAlive پایدار می‌شود.
git -C "$DEST" apply --check "$HERE/bgutil-keepalive.patch" 2>/dev/null \
  && git -C "$DEST" apply "$HERE/bgutil-keepalive.patch" \
  || echo "    (از قبل اعمال شده)"

echo "==> نصب وابستگی‌ها و بیلد"
cd "$DEST/server"
npm ci --no-audit --no-fund
npx tsc

test -f build/generate_once.js || { echo "بیلد ناموفق بود"; exit 1; }

echo "==> تست تولید توکن"
node build/generate_once.js --content-binding "dQw4w9WgXcQ" 2>&1 \
  | grep -q '"poToken"' \
  && echo "    توکن تولید شد ✓" \
  || { echo "    تولید توکن ناموفق بود"; exit 1; }

echo
echo "آماده است. بک‌اند خودش vendor/ را پیدا می‌کند."
