/* proxy.js — same-origin proxy to api.cloudflare.com
   حل CORS + مسدودسازی شبکه. Worker catch-all (entry point).

   نصب (یک‌بار، حدود ۱ دقیقه، بدون نیاز به CLI):
   ۱) برو به dash.cloudflare.com → Workers & Pages → Create → Create Worker
   ۲) یک اسم بگذار (مثلاً cf-proxy) → Deploy
   ۳) Edit code → کل کد پیش‌فرض را پاک کن → همین فایل را جایگزینش کن → Deploy
   ۴) آدرس نهایی (مثل https://cf-proxy.YOUR-SUBDOMAIN.workers.dev) را در
      ویزارد → تنظیمات → «آدرس Worker پروکسی» وارد کن.

   نکته: توکن Cloudflare با هدر سفارشی X-CF-Token فرستاده می‌شود (نه Authorization)،
   و خودِ این Worker آن را قبل از فوروارد کردن به Authorization: Bearer ... تبدیل می‌کند.
   مسیرها هم به‌جای صدا زدن مستقیم api.cloudflare.com/client/v4/...، از
   /__cf/... رد می‌شوند (مثلاً /__cf/accounts → https://api.cloudflare.com/client/v4/accounts).

   بونس: اگر بعداً بخواهی همین Worker خودِ ویزارد را هم سرو کند (به‌جای GitHub Pages)،
   کافی است در wrangler.toml یک [assets] binding به اسم ASSETS اضافه کنی که به پوشه‌ی
   wizard/ اشاره کند؛ این فایل از قبل برای آن حالت هم آماده است. */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const reqOrigin = request.headers.get('Origin') || url.origin;
    const PREFIX = '/__cf/';
    // ---- پراکسی: مرورگر -> این ورکر -> api.cloudflare.com ----
    if (url.pathname.startsWith(PREFIX)) {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': reqOrigin,
          'Access-Control-Allow-Headers': 'X-CF-Token, Content-Type',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
          'Access-Control-Max-Age': '86400',
          'Vary': 'Origin'
        }});
      }
      try {
        const token = request.headers.get('X-CF-Token') || '';
        const rest = url.pathname.slice(PREFIX.length);
        const target = 'https://api.cloudflare.com/client/v4/' + rest + url.search;
        const headers = new Headers();
        ['content-type', 'accept', 'if-none-match', 'if-modified-since'].forEach(k => {
          const v = request.headers.get(k); if (v) headers.set(k, v);
        });
        if (token) headers.set('Authorization', 'Bearer ' + token);
        const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
        const resp = await fetch(target, {
          method: request.method, headers,
          body: hasBody ? request.body : undefined
        });
        const out = new Headers();
        const deny = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);
        resp.headers.forEach((v, k) => { if (!deny.has(k.toLowerCase())) out.set(k, v); });
        out.set('Access-Control-Allow-Origin', reqOrigin);
        out.set('Vary', 'Origin');
        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: out });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: String((e && e.message) || e) }),
          { status: 502, headers: { 'content-type': 'application/json', 'Access-Control-Allow-Origin': url.origin } });
      }
    }
    // ---- بقیهٔ درخواست‌ها: سروِ سایت استاتیک ویزارد از assets (اختیاری) ----
    if (env.ASSETS && env.ASSETS.fetch) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};
