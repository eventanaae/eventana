// ODDLY menu: serves the iPad menu and stores orders in Postgres.
const http = require("http");
const fs = require("fs");
const path = require("path");
const pg = require("pg");
const { Pool } = pg;
if (pg.types) pg.types.setTypeParser(1082, v => v); // keep DATE as YYYY-MM-DD

const PORT = process.env.PORT || 10000;
const PIN = process.env.REPORT_PIN || ""; // set REPORT_PIN on the host
const TZ = "Asia/Dubai";
const PRICES = {
  "pudding": 35, "strawberry": 35, "hot-choc": 35, "matcha": 35, "golden-brew": 35,
  "matcha-ic": 35, "redbull-ic": 35, "karak-ic": 35, "acai-ic": 35, "greek-ic": 35, "vanilla-ic": 35, "acai-smoothie": 35
};
const NAMES = {
  "pudding": "Date Pudding", "strawberry": "Chocolate Strawberry", "hot-choc": "Hot Chocolate",
  "matcha": "Matcha", "golden-brew": "Iced V60", "matcha-ic": "Matcha Ice Cream",
  "redbull-ic": "Red Bull Ice Cream", "karak-ic": "Karak Ice Cream", "acai-ic": "Açaí Ice Cream",
  "greek-ic": "Greek Yogurt Ice Cream", "vanilla-ic": "Vanilla Ice Cream", "acai-smoothie": "Açaí Smoothie"
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  max: 4
});

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS oddly_orders (
    id SERIAL PRIMARY KEY,
    day DATE NOT NULL,
    num INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    items JSONB NOT NULL,
    qty INT NOT NULL,
    total INT NOT NULL,
    pay TEXT NOT NULL CHECK (pay IN ('cash','card'))
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS oddly_orders_day ON oddly_orders(day)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oddly_expenses (
    id SERIAL PRIMARY KEY,
    day DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    supplier TEXT NOT NULL,
    person TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS oddly_expenses_day ON oddly_expenses(day)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS oddly_expense_photos (
    expense_id INT PRIMARY KEY REFERENCES oddly_expenses(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    data TEXT NOT NULL
  )`);
}
const PEOPLE = ["شيم", "مريم", "فطيم"];
const validMonth = m => /^\d{4}-\d{2}$/.test(m || "");
function monthRange(m) {
  const [y, mo] = m.split("-").map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return [`${m}-01`, `${next}-01`];
}
const expOut = r => ({ id: r.id, day: String(r.day).slice(0, 10), amount: Number(r.amount), supplier: r.supplier, person: r.person, note: r.note || "", photo: !!r.has_photo });

function dubaiParts(d = new Date()) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}` };
}
const rowOut = r => ({
  id: r.id, num: r.num, day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
  time: dubaiParts(new Date(r.created_at)).time, items: r.items, qty: r.qty, total: r.total, pay: r.pay
});

function send(res, code, body, type = "application/json; charset=utf-8", extra = {}) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", ...extra });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 20000) {
  return new Promise((ok, bad) => {
    let s = ""; req.on("data", c => { s += c; if (s.length > limit) { bad(new Error("too big")); req.destroy(); } });
    req.on("end", () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { bad(e); } });
  });
}
const pinOk = (req, url) => !!PIN && (req.headers["x-pin"] || url.searchParams.get("pin")) === PIN;
const validDay = d => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

const STATIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".json": "application/json", ".js": "text/javascript", ".css": "text/css" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname.startsWith("/api/") && !dbReady) return send(res, 503, { error: "db" });
    if (url.pathname === "/api/orders" && req.method === "POST") {
      const b = await readBody(req);
      if (!["cash", "card"].includes(b.pay)) return send(res, 400, { error: "pay" });
      const items = (Array.isArray(b.items) ? b.items : [])
        .filter(i => PRICES[i.id] && Number.isInteger(i.q) && i.q > 0 && i.q < 50)
        .map(i => ({ id: i.id, en: NAMES[i.id], q: i.q, price: PRICES[i.id] }));
      if (!items.length) return send(res, 400, { error: "items" });
      const qty = items.reduce((a, i) => a + i.q, 0);
      const total = items.reduce((a, i) => a + i.q * i.price, 0);
      const { day } = dubaiParts();
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SELECT pg_advisory_xact_lock(7712001)");
        const n = await c.query("SELECT COALESCE(MAX(num),0)+1 AS n FROM oddly_orders WHERE day=$1", [day]);
        const r = await c.query("INSERT INTO oddly_orders(day,num,items,qty,total,pay) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
          [day, n.rows[0].n, JSON.stringify(items), qty, total, b.pay]);
        await c.query("COMMIT");
        return send(res, 200, rowOut(r.rows[0]));
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
    }
    if (url.pathname === "/api/orders" && req.method === "GET") {
      if (!pinOk(req, url)) return send(res, 401, { error: "pin" });
      const day = validDay(url.searchParams.get("day")) ? url.searchParams.get("day") : dubaiParts().day;
      const r = await pool.query("SELECT * FROM oddly_orders WHERE day=$1 ORDER BY created_at DESC", [day]);
      return send(res, 200, { day, orders: r.rows.map(rowOut) });
    }
    if (url.pathname.startsWith("/api/orders/") && req.method === "DELETE") {
      if (!pinOk(req, url)) return send(res, 401, { error: "pin" });
      const id = parseInt(url.pathname.split("/").pop(), 10);
      await pool.query("DELETE FROM oddly_orders WHERE id=$1", [id]);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/api/orders.csv" && req.method === "GET") {
      if (!pinOk(req, url)) return send(res, 401, "PIN", "text/plain");
      const day = validDay(url.searchParams.get("day")) ? url.searchParams.get("day") : dubaiParts().day;
      const r = await pool.query("SELECT * FROM oddly_orders WHERE day=$1 ORDER BY created_at ASC", [day]);
      const rows = [["رقم الطلب", "التاريخ", "الوقت", "الطلب", "عدد القطع", "المجموع (د.إ)", "طريقة الدفع"]];
      r.rows.map(rowOut).forEach(o => rows.push([o.num, o.day, o.time, o.items.map(i => `${i.q}x ${i.en}`).join(" + "), o.qty, o.total, o.pay === "cash" ? "كاش" : "بطاقة"]));
      const csv = "﻿" + rows.map(x => x.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      return send(res, 200, csv, "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="ODDLY-orders-${day}.csv"` });
    }

    // ----- Expenses (PIN) -----
    if (url.pathname === "/api/expenses" && req.method === "GET") {
      if (!pinOk(req, url)) return send(res, 401, { error: "pin" });
      const month = validMonth(url.searchParams.get("month")) ? url.searchParams.get("month") : dubaiParts().day.slice(0, 7);
      const [from, to] = monthRange(month);
      const r = await pool.query(`SELECT e.*, (p.expense_id IS NOT NULL) AS has_photo FROM oddly_expenses e
        LEFT JOIN oddly_expense_photos p ON p.expense_id = e.id WHERE e.day >= $1 AND e.day < $2 ORDER BY e.day DESC, e.id DESC`, [from, to]);
      const sales = await pool.query("SELECT COALESCE(SUM(total),0) AS s, COUNT(*) AS n FROM oddly_orders WHERE day >= $1 AND day < $2", [from, to]);
      return send(res, 200, { month, expenses: r.rows.map(expOut), sales: Number(sales.rows[0].s), orders: Number(sales.rows[0].n) });
    }
    if (url.pathname === "/api/expenses" && req.method === "POST") {
      if (!pinOk(req, url)) return send(res, 401, { error: "pin" });
      const b = await readBody(req, 12 * 1024 * 1024);
      const amount = Math.round(Number(b.amount) * 100) / 100;
      const supplier = String(b.supplier || "").trim().slice(0, 120);
      const note = String(b.note || "").trim().slice(0, 300);
      if (!validDay(b.day) || !(amount > 0) || amount > 10000000 || !supplier || !PEOPLE.includes(b.person)) return send(res, 400, { error: "fields" });
      let photo = null;
      if (b.photo && typeof b.photo.data === "string") {
        if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(b.photo.mime || "")) return send(res, 400, { error: "photo" });
        if (!/^[A-Za-z0-9+/=]+$/.test(b.photo.data)) return send(res, 400, { error: "photo" });
        photo = b.photo;
      }
      const r = await pool.query("INSERT INTO oddly_expenses(day,amount,supplier,person,note) VALUES($1,$2,$3,$4,$5) RETURNING *", [b.day, amount, supplier, b.person, note]);
      const row = r.rows[0];
      if (photo) await pool.query("INSERT INTO oddly_expense_photos(expense_id,mime,data) VALUES($1,$2,$3)", [row.id, photo.mime, photo.data]);
      row.has_photo = !!photo;
      return send(res, 200, expOut(row));
    }
    let m;
    if ((m = url.pathname.match(/^\/api\/expenses\/(\d+)\/photo$/)) && req.method === "GET") {
      if (!pinOk(req, url)) return send(res, 401, "PIN", "text/plain");
      const r = await pool.query("SELECT mime, data FROM oddly_expense_photos WHERE expense_id=$1", [Number(m[1])]);
      if (!r.rows.length) return send(res, 404, "Not found", "text/plain");
      res.writeHead(200, { "Content-Type": r.rows[0].mime, "Cache-Control": "private, max-age=86400" });
      return res.end(Buffer.from(r.rows[0].data, "base64"));
    }
    if ((m = url.pathname.match(/^\/api\/expenses\/(\d+)$/)) && req.method === "DELETE") {
      if (!pinOk(req, url)) return send(res, 401, { error: "pin" });
      await pool.query("DELETE FROM oddly_expenses WHERE id=$1", [Number(m[1])]);
      return send(res, 200, { ok: true });
    }
    if (url.pathname === "/api/expenses.csv" && req.method === "GET") {
      if (!pinOk(req, url)) return send(res, 401, "PIN", "text/plain");
      const month = validMonth(url.searchParams.get("month")) ? url.searchParams.get("month") : dubaiParts().day.slice(0, 7);
      const [from, to] = monthRange(month);
      const r = await pool.query("SELECT * FROM oddly_expenses WHERE day >= $1 AND day < $2 ORDER BY day ASC, id ASC", [from, to]);
      const rows = [["التاريخ", "المورد", "المبلغ (درهم)", "رفعه", "ملاحظة"]];
      r.rows.map(expOut).forEach(e => rows.push([e.day, e.supplier, e.amount.toFixed(2), e.person, e.note]));
      const csv = "\uFEFF" + rows.map(x => x.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
      return send(res, 200, csv, "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="ODDLY-expenses-${month}.csv"` });
    }
    if (url.pathname === "/healthz") return send(res, 200, { ok: true });

    // static files
    let p = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const file = path.join(STATIC, path.normalize(p).replace(/^(\.\.[\/\\])+/, ""));
    if (!file.startsWith(STATIC)) return send(res, 404, "Not found", "text/plain");
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, "Not found", "text/plain");
      const ext = path.extname(file);
      res.writeHead(200, { "Content-Type": TYPES[ext] || "application/octet-stream", "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=604800" });
      res.end(data);
    });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: "server" });
  }
});

let dbReady = false;
async function connectDb() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set: orders cannot be saved yet"); return; }
  try { await init(); dbReady = true; console.log("Database ready"); }
  catch (e) { console.error("DB init failed, retrying in 15s", e.message); setTimeout(connectDb, 15000); }
}
server.listen(PORT, () => { console.log("ODDLY menu on", PORT); connectDb(); });
