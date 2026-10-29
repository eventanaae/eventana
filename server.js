// HR Business Partner Tasks: personal task list with AI categories, achievements and morning push reminders.
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pg = require("pg");
let webpush = null;
try { webpush = require("web-push"); } catch (_) { console.warn("web-push not installed; notifications off"); }
if (pg.types) pg.types.setTypeParser(1082, v => v);

const PORT = process.env.PORT || 10000;
const TZ = "Asia/Dubai";
const AI_KEY = process.env.ANTHROPIC_API_KEY || "";
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "https://hr-business-partner-tasks.onrender.com";
const DIGEST_AT = process.env.DIGEST_TIME || "07:44"; // Dubai time
const MODEL_QUICK = process.env.AI_MODEL_QUICK || "claude-haiku-5-5";
const MODEL_MAIN = process.env.AI_MODEL_MAIN || "claude-sonnet-5-5";
const AI_DAILY_CAP = 150;

if (webpush && VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
const pushOn = () => !!(webpush && VAPID_PUBLIC && VAPID_PRIVATE);

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  max: 4
});

async function init() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS hrbp`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hrbp.users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    pw TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hrbp.sessions (
    token TEXT PRIMARY KEY,
    user_id INT NOT NULL REFERENCES hrbp.users(id) ON DELETE CASCADE,
    expires TIMESTAMPTZ NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hrbp.tasks (
    user_id INT NOT NULL REFERENCES hrbp.users(id) ON DELETE CASCADE,
    id TEXT NOT NULL,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hrbp.push (
    endpoint TEXT PRIMARY KEY,
    user_id INT NOT NULL REFERENCES hrbp.users(id) ON DELETE CASCADE,
    sub JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hrbp.digest_sent (
    user_id INT NOT NULL REFERENCES hrbp.users(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    PRIMARY KEY (user_id, day)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hrbp.ai_usage (
    user_id INT NOT NULL REFERENCES hrbp.users(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    n INT NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  )`);
}

// ---------- helpers ----------
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".css": "text/css; charset=utf-8" };
function send(res, code, body, headers = {}) {
  const isObj = body !== null && typeof body === "object" && !Buffer.isBuffer(body);
  res.writeHead(code, Object.assign({ "content-type": isObj ? "application/json" : "text/plain; charset=utf-8", "cache-control": "no-store" }, headers));
  res.end(isObj ? JSON.stringify(body) : body);
}
function readBody(req, limit = 300000) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > limit) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (_) { reject(Object.assign(new Error("bad json"), { status: 400 })); } });
    req.on("error", reject);
  });
}
function cookies(req) { const o = {}; (req.headers.cookie || "").split(";").forEach(p => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }); return o; }
function hashPw(pw) { const salt = crypto.randomBytes(16).toString("hex"); const h = crypto.scryptSync(pw, salt, 64).toString("hex"); return salt + ":" + h; }
function checkPw(pw, stored) { const [salt, h] = String(stored).split(":"); if (!salt || !h) return false; const x = crypto.scryptSync(pw, salt, 64); const y = Buffer.from(h, "hex"); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function dubaiNow() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  return { day: `${g("year")}-${g("month")}-${g("day")}`, hm: `${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}` };
}
function addDays(ymd, n) { const [y, m, d] = ymd.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d + n)); return dt.toISOString().slice(0, 10); }
const validId = id => /^[A-Za-z0-9_-]{1,64}$/.test(id || "");
const validEmail = e => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e || "");

async function newSession(res, userId) {
  const token = crypto.randomBytes(32).toString("hex");
  await pool.query(`INSERT INTO hrbp.sessions(token,user_id,expires) VALUES($1,$2,now()+interval '180 days')`, [token, userId]);
  res.setHeader("set-cookie", `hrbp_s=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${180 * 86400}`);
}
async function currentUser(req) {
  const t = cookies(req).hrbp_s; if (!t || !/^[a-f0-9]{64}$/.test(t)) return null;
  const r = await pool.query(`SELECT u.id,u.email,u.name,u.profile FROM hrbp.sessions s JOIN hrbp.users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires>now()`, [t]);
  return r.rows[0] || null;
}

// simple login throttle
const attempts = new Map();
function throttled(key) { const now = Date.now(); const a = (attempts.get(key) || []).filter(t => now - t < 15 * 60000); attempts.set(key, a); return a.length >= 10; }
function noteAttempt(key) { const a = attempts.get(key) || []; a.push(Date.now()); attempts.set(key, a); }

// ---------- AI ----------
async function callClaude(prompt, { model, json, maxTokens }) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": AI_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens || 1200, messages: [{ role: "user", content: json ? prompt + "\n\nReply with the JSON only, no other text." : prompt }] })
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((data.error && data.error.message) || "AI error"); e.status = r.status === 429 ? 429 : 502; throw e; }
  const text = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("").trim();
  if (!json) return { text };
  const m = text.match(/\{[\s\S]*\}/);
  try { return { json: JSON.parse(m ? m[0] : text) }; } catch (_) { const e = new Error("AI returned unreadable JSON"); e.status = 502; throw e; }
}

// ---------- special days (same list as the page) ----------
function hijri(d) { try { const p = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", timeZone: TZ }).formatToParts(d); return { m: +p.find(x => x.type === "month").value, d: +p.find(x => x.type === "day").value }; } catch (_) { return null; } }
function occasionOn(ymd) {
  const [y, mo, da] = ymd.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 1, da, 8)); const md = mo * 100 + da; const h = hijri(d);
  if (h) {
    if (h.m === 9 && h.d === 19) return "Zayed Humanitarian Day 🤍";
    if (h.m === 9 && h.d === 1) return "the first day of Ramadan 🌙";
    if (h.m === 10 && h.d === 1) return "Eid Al Fitr 🎉";
    if (h.m === 12 && h.d === 9) return "Arafah Day 🕋";
    if (h.m === 12 && h.d === 10) return "Eid Al Adha 🐑";
    if (h.m === 1 && h.d === 1) return "Islamic New Year 🌙";
    if (h.m === 3 && h.d === 12) return "the Prophet's Birthday 🌙";
    if (h.m === 7 && h.d === 27) return "Isra and Mi'raj 🌙";
  }
  return ({ 101: "New Year's Day 🎆", 214: "Valentine's Day 💕", 308: "International Women's Day 💐", 315: "Emirati Children's Day 🧸", 321: "Mother's Day 🌷", 520: "International HR Day 🤝", 621: "Father's Day 👔", 828: "Emirati Women's Day 🇦🇪", 1005: "World Teachers' Day 🍎", 1010: "World Mental Health Day 💚", 1031: "Halloween 🎃", 1103: "UAE Flag Day 🇦🇪", 1130: "Commemoration Day 🕊️", 1202: "UAE National Day 🇦🇪", 1225: "Christmas 🎄", 1231: "New Year's Eve 🥂" })[md] || null;
}

async function digestFor(userId, day) {
  const r = await pool.query(`SELECT data FROM hrbp.tasks WHERE user_id=$1 AND data->>'status' IS DISTINCT FROM 'done' AND COALESCE(data->>'due','')<>''`, [userId]);
  const tm = addDays(day, 1);
  const T = r.rows.map(x => x.data);
  const today = T.filter(t => t.due === day).map(t => t.title);
  const tomorrow = T.filter(t => t.due === tm).map(t => t.title);
  const late = T.filter(t => t.due < day).map(t => t.title);
  const lines = [];
  const occ = occasionOn(day), occT = occasionOn(tm);
  if (occ) lines.push(`Today is ${occ}`);
  if (today.length) lines.push(`📌 Due today: ${today.join(", ")}`);
  if (tomorrow.length) lines.push(`⏰ Due tomorrow: ${tomorrow.join(", ")}`);
  if (late.length) lines.push(`⚠️ Overdue: ${late.join(", ")}`);
  if (occT) lines.push(`🗓️ Tomorrow is ${occT}`);
  return lines;
}
async function pushTo(userId, payload) {
  if (!pushOn()) return 0;
  const subs = await pool.query(`SELECT endpoint, sub FROM hrbp.push WHERE user_id=$1`, [userId]);
  let ok = 0;
  for (const s of subs.rows) {
    try { await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 6 * 3600 }); ok++; }
    catch (e) { if (e.statusCode === 404 || e.statusCode === 410) await pool.query(`DELETE FROM hrbp.push WHERE endpoint=$1`, [s.endpoint]); else console.error("push failed", e.statusCode || e.message); }
  }
  return ok;
}
let digestRunning = false;
async function digestTick() {
  if (digestRunning || !pushOn()) return;
  const { day, hm } = dubaiNow();
  if (hm < DIGEST_AT) return;
  digestRunning = true;
  try {
    const users = await pool.query(`SELECT DISTINCT p.user_id FROM hrbp.push p WHERE NOT EXISTS (SELECT 1 FROM hrbp.digest_sent d WHERE d.user_id=p.user_id AND d.day=$1)`, [day]);
    for (const { user_id } of users.rows) {
      await pool.query(`INSERT INTO hrbp.digest_sent(user_id,day) VALUES($1,$2) ON CONFLICT DO NOTHING`, [user_id, day]);
      const lines = await digestFor(user_id, day);
      if (lines.length) await pushTo(user_id, { title: "HR Business Partner Tasks", body: lines.join("\n"), url: "/" });
    }
  } catch (e) { console.error("digest", e.message); }
  finally { digestRunning = false; }
}

// ---------- routes ----------
async function api(req, res, url) {
  const p = url.pathname;
  if (p === "/api/health") return send(res, 200, { ok: true });

  if (p === "/api/signup" && req.method === "POST") {
    const b = await readBody(req); const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 40); const pw = String(b.password || "");
    const email = name.toLowerCase(); // login name, stored in the email column
    if (name.length < 2) return send(res, 400, { error: "Choose a name with at least 2 letters." });
    if (pw.length < 6) return send(res, 400, { error: "Use at least 6 characters for your password." });
    const ex = await pool.query(`SELECT 1 FROM hrbp.users WHERE email=$1`, [email]);
    if (ex.rowCount) return send(res, 409, { error: "This name is taken. Sign in, or pick another name." });
    const u = await pool.query(`INSERT INTO hrbp.users(email,pw,name) VALUES($1,$2,$3) RETURNING id`, [email, hashPw(pw), name]);
    await newSession(res, u.rows[0].id);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/login" && req.method === "POST") {
    const b = await readBody(req); const email = String(b.name || b.email || "").trim().replace(/\s+/g, " ").toLowerCase(); const pw = String(b.password || "");
    const key = email + "|" + (req.headers["x-forwarded-for"] || "").split(",")[0];
    if (throttled(key)) return send(res, 429, { error: "Too many tries. Wait 15 minutes and try again." });
    const u = await pool.query(`SELECT id,pw FROM hrbp.users WHERE email=$1`, [email]);
    if (!u.rowCount || !checkPw(pw, u.rows[0].pw)) { noteAttempt(key); return send(res, 401, { error: "Name or password is wrong." }); }
    await newSession(res, u.rows[0].id);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/logout" && req.method === "POST") {
    const t = cookies(req).hrbp_s; if (t) await pool.query(`DELETE FROM hrbp.sessions WHERE token=$1`, [t]);
    res.setHeader("set-cookie", "hrbp_s=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return send(res, 200, { ok: true });
  }

  const me = await currentUser(req);
  if (!me) return send(res, 401, { error: "Sign in first." });

  if (p === "/api/me" && req.method === "GET") return send(res, 200, { email: me.email, name: me.name, profile: me.profile, ai: !!AI_KEY, push: pushOn(), vapid: VAPID_PUBLIC });
  if (p === "/api/me" && req.method === "PUT") {
    const b = await readBody(req);
    const name = b.name != null ? String(b.name).trim().slice(0, 40) : me.name;
    const profile = b.profile && typeof b.profile === "object" ? b.profile : me.profile;
    delete profile.name;
    if (JSON.stringify(profile).length > 60000) return send(res, 413, { error: "Profile too large." });
    await pool.query(`UPDATE hrbp.users SET name=$1, profile=$2 WHERE id=$3`, [name || me.name, profile, me.id]);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/tasks" && req.method === "GET") {
    const r = await pool.query(`SELECT id,data FROM hrbp.tasks WHERE user_id=$1 ORDER BY id`, [me.id]);
    return send(res, 200, r.rows);
  }
  const tm = p.match(/^\/api\/tasks\/([^/]+)$/);
  if (tm) {
    const id = decodeURIComponent(tm[1]); if (!validId(id)) return send(res, 400, { error: "Bad task id." });
    if (req.method === "PUT") {
      const b = await readBody(req); if (!b || typeof b !== "object" || Array.isArray(b)) return send(res, 400, { error: "Bad task." });
      const c = await pool.query(`SELECT count(*)::int n FROM hrbp.tasks WHERE user_id=$1`, [me.id]);
      if (c.rows[0].n > 5000) return send(res, 413, { error: "Task limit reached." });
      await pool.query(`INSERT INTO hrbp.tasks(user_id,id,data) VALUES($1,$2,$3) ON CONFLICT (user_id,id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [me.id, id, b]);
      return send(res, 200, { ok: true });
    }
    if (req.method === "PATCH") {
      const b = await readBody(req);
      const r = await pool.query(`UPDATE hrbp.tasks SET data=data||$3::jsonb, updated_at=now() WHERE user_id=$1 AND id=$2`, [me.id, id, JSON.stringify(b || {})]);
      return r.rowCount ? send(res, 200, { ok: true }) : send(res, 404, { error: "Task not found." });
    }
    if (req.method === "DELETE") { await pool.query(`DELETE FROM hrbp.tasks WHERE user_id=$1 AND id=$2`, [me.id, id]); return send(res, 200, { ok: true }); }
  }
  if (p === "/api/ai" && req.method === "POST") {
    if (!AI_KEY) return send(res, 503, { error: "AI is not set up yet." });
    const b = await readBody(req); const prompt = String(b.prompt || "");
    if (!prompt || prompt.length > 60000) return send(res, 400, { error: "Bad request." });
    const { day } = dubaiNow();
    const u = await pool.query(`INSERT INTO hrbp.ai_usage(user_id,day,n) VALUES($1,$2,1) ON CONFLICT (user_id,day) DO UPDATE SET n=hrbp.ai_usage.n+1 RETURNING n`, [me.id, day]);
    if (u.rows[0].n > AI_DAILY_CAP) return send(res, 429, { error: "Daily AI limit reached." });
    const out = await callClaude(prompt, { model: b.tier === "main" ? MODEL_MAIN : MODEL_QUICK, json: !!b.json, maxTokens: b.tier === "main" ? 1500 : 800 });
    return send(res, 200, out);
  }
  if (p === "/api/push/subscribe" && req.method === "POST") {
    if (!pushOn()) return send(res, 503, { error: "Notifications are not set up yet." });
    const b = await readBody(req); const sub = b.sub;
    if (!sub || typeof sub.endpoint !== "string" || !/^https:\/\//.test(sub.endpoint) || !sub.keys) return send(res, 400, { error: "Bad subscription." });
    await pool.query(`INSERT INTO hrbp.push(endpoint,user_id,sub) VALUES($1,$2,$3) ON CONFLICT (endpoint) DO UPDATE SET user_id=EXCLUDED.user_id, sub=EXCLUDED.sub`, [sub.endpoint, me.id, sub]);
    return send(res, 200, { ok: true });
  }
  if (p === "/api/push/test" && req.method === "POST") {
    const n = await pushTo(me.id, { title: "HR Business Partner Tasks", body: "Notifications are on 💗 You'll get your deadlines every morning.", url: "/" });
    return send(res, 200, { sent: n });
  }
  if (p === "/api/digest/preview" && req.method === "GET") {
    const { day } = dubaiNow(); return send(res, 200, { lines: await digestFor(me.id, day) });
  }
  return send(res, 404, { error: "Not found." });
}

const PUB = path.join(__dirname, "public");
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) return send(res, 404, "Not found");
  fs.readFile(f, (err, buf) => {
    if (err) return send(res, 404, "Not found");
    const ext = path.extname(f);
    const h = { "content-type": MIME[ext] || "application/octet-stream", "cache-control": ext === ".png" ? "public, max-age=86400" : "no-cache", "x-content-type-options": "nosniff" };
    if (p === "/sw.js") h["service-worker-allowed"] = "/";
    res.writeHead(200, h); res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "Something went wrong. Try again." });
  }
});

init().then(() => {
  server.listen(PORT, () => console.log("HR Business Partner Tasks on", PORT));
  setInterval(digestTick, 60000); setTimeout(digestTick, 5000);
  setInterval(() => pool.query(`DELETE FROM hrbp.sessions WHERE expires<now()`).catch(() => {}), 6 * 3600000);
}).catch(e => { console.error("init failed", e); process.exit(1); });
