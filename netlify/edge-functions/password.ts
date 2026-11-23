// Server-side password gate for the Riyadh General Map.
// Built-in password below. To override it without editing code, set PROTECTED_PAGE_PASSWORD
// in Netlify (Site configuration → Environment variables) and redeploy.
import type { Config, Context } from "https://edge.netlify.com";

const DEFAULT_PASSWORD = "Riyadh@2026";
const COOKIE = "rgm_auth";
const MAX_AGE = 60 * 60 * 24 * 7; // stay signed in for 7 days

async function token(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("riyadh-general-map:v1"));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
function cookie(req: Request, name: string): string {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}
function page(error = "", status = 401): Response {
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>الخريطة العامة للرياض · تسجيل الدخول</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:grid;place-items:center;padding:16px;background:#17322c;
  font:14px/1.45 "IBM Plex Sans Arabic",system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;color:#151513}
form{background:#fdfcfa;border-radius:12px;padding:28px 26px;width:min(380px,100%);display:grid;gap:8px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
h1{font-size:22px;margin-top:6px}.ar{color:#55534d;font-size:16px;margin-top:-6px}
label{font-size:12.5px;color:#55534d;margin-top:10px}
input{border:1px solid #dddad2;border-radius:8px;padding:10px 12px;font-size:16px;min-height:44px}
button{border:0;border-radius:8px;background:#234a41;color:#fff;font-weight:700;padding:11px;cursor:pointer;min-height:44px;margin-top:4px;font-size:15px}
input:focus-visible,button:focus-visible{outline:2px solid #f2c14e;outline-offset:2px}
.err{color:#b5452e;font-size:13px;font-weight:600}
</style></head><body>
<form method="post" action="/__login">
  <svg viewBox="0 0 32 32" width="40" height="40" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#f2c14e"/><path d="M8 23V9h4v14zM14 23v-9h4v9zM20 23v-6h4v6z" fill="#17322c"/></svg>
  <h1>الخريطة العامة للرياض</h1>
  <p class="ar" lang="en">Riyadh General Map</p>
  <label for="pw">كلمة المرور</label>
  <input id="pw" name="password" type="password" required autofocus autocomplete="current-password" dir="ltr">
  <button type="submit">فتح الخريطة</button>
  ${error ? `<p class="err">${error}</p>` : ""}
</form></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export default async (req: Request, context: Context) => {
  const password = Netlify.env.get("PROTECTED_PAGE_PASSWORD") || DEFAULT_PASSWORD;
  const expected = await token(password);
  const url = new URL(req.url);

  if (url.pathname === "/__logout") {
    const h = new Headers({ location: "/" });
    h.append("set-cookie", `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
    h.append("set-cookie", `rgm_ok=; Path=/; Max-Age=0; Secure; SameSite=Lax`);
    return new Response(null, { status: 303, headers: h });
  }
  if (url.pathname === "/__login" && req.method === "POST") {
    const form = await req.formData().catch(() => null);
    const given = String(form?.get("password") || "");
    if (!same(await token(given), expected)) return page("كلمة المرور غير صحيحة");
    const h = new Headers({ location: "/" });
    h.append("set-cookie", `${COOKIE}=${expected}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`);
    // readable flag so the page skips its own password screen (it proves nothing on its own)
    h.append("set-cookie", `rgm_ok=1; Path=/; Max-Age=${MAX_AGE}; Secure; SameSite=Lax`);
    return new Response(null, { status: 303, headers: h });
  }
  if (same(cookie(req, COOKIE), expected)) {
    const res = await context.next();
    res.headers.set("cache-control", "private, no-store");
    return res;
  }
  return page("", 401);
};

export const config: Config = { path: "/*" };
