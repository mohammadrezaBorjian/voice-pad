# واژه — Voice Pad

تبدیل گفتار به متن فارسی و انگلیسی با **Whisper Large V3 Turbo**، روی **macOS و Linux**.
صدا روی همان دستگاه پردازش می‌شود. رابط مرورگر، ضبط میکروفون، پیش‌نویس زنده،
متن قابل ویرایش، کپی با یک کلیک و انتخاب میکروفون دارد.

## نصب روی مک یا لینوکس

نیازمندی‌ها: Git، Python 3.10 یا جدیدتر (پیشنهاد: **3.12**)، `curl` و مرورگر به‌روز.
روی مک Intel و Apple Silicon از CPU استفاده می‌شود؛ نیازی به CUDA نیست.
اگر Python نداری، روی مک با Homebrew بزن `brew install python@3.12` یا
از [python.org](https://www.python.org/downloads/macos/) نصب کن.

```bash
git clone https://github.com/mohammadrezaBorjian/voice-pad.git
cd voice-pad
bash setup.sh
bash run.sh
```

`setup.sh` محیط مستقل `.venv` را می‌سازد، وابستگی‌ها و مدل حدود **۱٫۶ گیگابایتی** را
دانلود و صحت فایل‌های مدل را بررسی می‌کند. اگر `uv` نصب باشد، خودکار از آن استفاده می‌شود.
برای نصب اولیه اینترنت لازم است؛ اجرای بعدی آفلاین است.

مرورگر باز می‌شود: **<http://127.0.0.1:8791>**.
برای اجراهای بعدی فقط `bash run.sh` کافی است. روی مک بعد از نصب اولیه می‌توانی
فایل **`Voice Pad.command`** را هم در Finder دوبار کلیک کنی.

## استفاده

۱. زبان را انتخاب کن؛ فارسی پیش‌فرض است.
۲. روی میکروفون بزن و اجازهٔ دسترسی میکروفون را در مرورگر بده.
۳. صحبت کن؛ متن کم‌رنگ پیش‌نویس است و بعد از مکث یا توقف نهایی می‌شود.
۴. با «کپی متن» کپی کن؛ بعد از پایان تبدیل، متن را می‌توانی ویرایش کنی.

میان‌بر در پنجرهٔ فعال: **Ctrl+Shift+Space** در لینوکس و **⌘+Shift+Space** در مک.
اگر در مک صدا دریافت نشد، دسترسی مرورگر را در
**System Settings → Privacy & Security → Microphone** بررسی کن.

پیش‌نویس هر حدود ۲٫۵ ثانیه برای پردازش فرستاده می‌شود و زمان اجرای مدل هم به آن اضافه می‌شود.
این مدل روی CPU کلمه‌به‌کلمه و بدون تأخیر نیست. جمله‌ها بعد از حدود ۷۰۰ میلی‌ثانیه مکث
یا حداکثر ۱۲ ثانیه نهایی می‌شوند. اگر پردازش عقب بیفتد، صدا صف می‌شود؛ در سقف ۲۴ بخش،
ضبط خودکار متوقف می‌شود تا صداهای دریافت‌شده پردازش شوند.

## تنظیمات

مدل پیش‌فرض در `models/large-v3-turbo` و Python در `.venv/bin/python` قرار می‌گیرد.
نسخه و هش مدل در [model-lock.json](model-lock.json) ثبت شده‌اند.
وزن‌های حجیم در گیت نیستند؛ دانلود ناتمام با اجرای مجدد `bash setup.sh` ادامه پیدا می‌کند.
مدل فقط یک بار هنگام شروع سرور بارگذاری می‌شود و نام آن پایین صفحه دیده می‌شود.

برای Python یا مدل محلی دیگر با فرمت CTranslate2:

```bash
VOICE_PAD_PYTHON=/path/to/venv/bin/python \
VOICE_PAD_MODEL=/path/to/local/model \
VOICE_PAD_PORT=8792 bash run.sh
```

این تنظیمات هنگام راه‌اندازی سرور جدید اعمال می‌شوند. مدل باید فایل‌های
`model.bin`، `config.json` و `tokenizer.json` داشته باشد.
اجرای سرور داخل ترمینال (Ctrl+C برای توقف):

```bash
.venv/bin/python server.py --port 8791
```

سروری که با `run.sh` اجرا می‌شود پس از بستن مرورگر روشن می‌ماند؛ میکروفون فقط هنگام ضبط فعال است.
PID را با `pgrep -fl 'server.py --port 8791'` پیدا کن و برای توقف به همان PID، `kill` بده.
خطاهای سرور در مک در `~/Library/Caches/voice-pad/server.log` و در لینوکس در
`~/.cache/voice-pad/server.log` هستند؛ `XDG_CACHE_HOME` این محل را تغییر می‌دهد.

## میان‌بر دسکتاپ لینوکس

```bash
.venv/bin/python install-desktop.py
```

«واژه / Voice Pad» به فهرست برنامه‌ها و دسکتاپ اضافه می‌شود.
اگر GNOME خواست، از منوی فایل دسکتاپ «Allow Launching» را بزن.

## داده‌ها

صدا فقط در RAM پردازش می‌شود و به دیسک یا اینترنت نمی‌رود.
صدای بخش‌های موفق بعد از تبدیل آزاد می‌شود؛ بخش ناموفق تا تلاش دوباره یا پاک‌کردن
در حافظهٔ همان صفحه می‌ماند. صفحه را موقع پردازش نبند.
متن نهایی در `localStorage` مرورگر می‌ماند؛ «پاک‌کردن» آن را پاک می‌کند.
سرور فقط روی `127.0.0.1` گوش می‌کند.

## توسعه و تست

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
node --test tests/audio.test.mjs
```

GitHub Actions این بررسی‌ها را روی لینوکس و macOS اجرا می‌کند؛ تست‌های CI نیازی به مدل ندارند.
برای تست اختیاری مرورگر با مدل واقعی، Playwright و Google Chrome را نصب کن و یک WAV گفتاری بده:

```bash
npm install --no-save --package-lock=false playwright
bash run.sh --no-open
VOICE_PAD_TEST_WAV=/absolute/path/to/speech.wav node tests/browser.cjs
```

نمونهٔ مرورگر باید گفتار انگلیسی نمونهٔ JFK با عبارت «my fellow Americans» داشته باشد؛
این تست تبدیل، نمایش زنده، تخلیهٔ صف، کپی، ویرایش فارسی، بازیابی متن و اندازهٔ موبایل را بررسی می‌کند.
مسیرهای Playwright، Chrome و سرور با `PLAYWRIGHT_MODULE`، `CHROME_PATH` و `VOICE_PAD_TEST_URL` قابل تغییرند.

## مدل و موتور

- [Whisper Large V3 Turbo — OpenAI](https://huggingface.co/openai/whisper-large-v3-turbo)
- [نسخهٔ CTranslate2 مدل](https://huggingface.co/dropbox-dash/faster-whisper-large-v3-turbo)، مجوز MIT
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [پشتیبانی CTranslate2 از macOS Intel و ARM64](https://opennmt.net/CTranslate2/installation.html)

پردازش با CPU و `int8` انجام می‌شود؛ مدل نهایی `beam_size=5` و پیش‌نویس `beam_size=1` دارد.
