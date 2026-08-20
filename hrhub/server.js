/**
 * HR Team Hub — a single-page app plus the small API behind it.
 *
 * The 21 project cards (title, owner, dates, HeyGen video) stay where they
 * already live: the Lovable hub's Supabase table, read straight from the
 * browser with the same public key that site ships. Everything the team
 * *adds* — status moves, updates, comments, who-is-where, news — lives here,
 * in this service's own Postgres.
 *
 * No framework: node:http, node:fs and pg. That keeps the deploy a single
 * dependency and the cold start short on Render's free tier.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, 'public');
const PORT = Number(process.env.PORT || 3000);

/* ------------------------------------------------------------------ db */

/**
 * Managed Postgres terminates TLS with a chain Node ships no root for, so
 * verification is relaxed for remote hosts while the connection stays
 * encrypted. Render's internal `.internal` host and localhost go plaintext.
 */
function sslOption(url) {
  try {
    const host = new URL(url).hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.internal');
    return local ? undefined : { rejectUnauthorized: false };
  } catch {
    return undefined;
  }
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: sslOption(process.env.DATABASE_URL || ''),
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

// A pooled client can die between checkouts (a database restart, an idle
// timeout). Without this listener that surfaces as an unhandled 'error'.
pool.on('error', (err) => console.error('[db] idle client error:', err.message));

const SCHEMA = `
create table if not exists hr_people (
  id                text primary key,
  name              text not null,
  team              text not null,
  default_location  text not null default 'Dubai',
  created_at        timestamptz not null default now()
);

create table if not exists hr_project_state (
  project_id  text primary key,
  status      text not null default 'Not started',
  progress    int  not null default 0,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table if not exists hr_project_posts (
  id           bigserial primary key,
  project_id   text not null,
  kind         text not null default 'update',
  status       text,
  progress     int,
  body         text not null,
  author_id    text,
  author_name  text not null,
  author_team  text,
  created_at   timestamptz not null default now()
);
create index if not exists hr_project_posts_idx on hr_project_posts(project_id, created_at desc);

create table if not exists hr_presence (
  person_id    text not null,
  day          date not null,
  location     text not null,
  person_name  text not null,
  team         text not null,
  updated_at   timestamptz not null default now(),
  primary key (person_id, day)
);
create index if not exists hr_presence_day_idx on hr_presence(day);

create table if not exists hr_news (
  id           bigserial primary key,
  kind         text not null default 'news',
  title        text not null,
  body         text,
  team         text,
  location     text,
  starts_at    timestamptz,
  author_id    text,
  author_name  text not null,
  created_at   timestamptz not null default now()
);
create index if not exists hr_news_created_idx on hr_news(created_at desc);

create table if not exists hr_news_comments (
  id           bigserial primary key,
  news_id      bigint not null references hr_news(id) on delete cascade,
  body         text not null,
  author_name  text not null,
  created_at   timestamptz not null default now()
);
create index if not exists hr_news_comments_idx on hr_news_comments(news_id, created_at);
`;

async function migrate() {
  await pool.query(SCHEMA);
  console.log('[db] schema ready');
}

/* --------------------------------------------------------------- http */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

/** Reject anything larger than 64 KB so a stray client can't exhaust memory. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 65_536) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

const str = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const need = (v, max) => { const s = str(v, max); if (!s) throw new Error('missing field'); return s; };
const pct = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; };
/** Guard the date inputs that go straight into a query. */
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);

const STATUSES = ['Not started', 'On track', 'At risk', 'Delayed', 'Completed'];
const LOCATIONS = ['Dubai', 'Ras Al Khaimah', 'Al Ain', 'Muraqqabat', 'Al Fahidi'];
const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

/* -------------------------------------------------------------- routes */

async function apiRoute(req, res, url) {
  const p = url.pathname;

  // Everything the app needs on first paint, in one round trip.
  if (req.method === 'GET' && p === '/api/bootstrap') {
    const [state, posts, people, news, comments] = await Promise.all([
      pool.query('select * from hr_project_state'),
      pool.query('select * from hr_project_posts order by created_at desc limit 500'),
      pool.query('select * from hr_people order by name'),
      pool.query('select * from hr_news order by created_at desc limit 80'),
      pool.query('select * from hr_news_comments order by created_at limit 500'),
    ]);
    return send(res, 200, {
      state: state.rows, posts: posts.rows, people: people.rows,
      news: news.rows, comments: comments.rows,
    });
  }

  if (req.method === 'POST' && p === '/api/people') {
    const b = await readBody(req);
    const row = await pool.query(
      `insert into hr_people (id, name, team, default_location) values ($1,$2,$3,$4)
       on conflict (id) do update set name = excluded.name, team = excluded.team,
         default_location = excluded.default_location
       returning *`,
      [need(b.id, 64), need(b.name, 80), need(b.team, 40), oneOf(str(b.default_location, 40), LOCATIONS, 'Dubai')],
    );
    return send(res, 200, row.rows[0]);
  }

  // An update carries the project's new status; a comment is just words.
  if (req.method === 'POST' && p === '/api/posts') {
    const b = await readBody(req);
    const projectId = need(b.project_id, 80);
    const kind = b.kind === 'comment' ? 'comment' : 'update';
    const status = kind === 'update' ? oneOf(str(b.status, 40), STATUSES, 'Not started') : null;
    const progress = kind === 'update' ? pct(b.progress) : null;

    const post = await pool.query(
      `insert into hr_project_posts
         (project_id, kind, status, progress, body, author_id, author_name, author_team)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [projectId, kind, status, progress, need(b.body, 4000),
       str(b.author_id, 64), need(b.author_name, 80), str(b.author_team, 40)],
    );

    let state = null;
    if (kind === 'update') {
      const r = await pool.query(
        `insert into hr_project_state (project_id, status, progress, updated_by, updated_at)
         values ($1,$2,$3,$4, now())
         on conflict (project_id) do update set status = excluded.status,
           progress = excluded.progress, updated_by = excluded.updated_by, updated_at = now()
         returning *`,
        [projectId, status, progress, need(b.author_name, 80)],
      );
      state = r.rows[0];
    }
    return send(res, 200, { post: post.rows[0], state });
  }

  if (req.method === 'GET' && p === '/api/presence') {
    const from = day(url.searchParams.get('from'));
    const to = day(url.searchParams.get('to'));
    if (!from || !to) return send(res, 400, { error: 'from and to must be YYYY-MM-DD' });
    const r = await pool.query(
      `select person_id, to_char(day,'YYYY-MM-DD') as day, location, person_name, team
         from hr_presence where day between $1 and $2`, [from, to],
    );
    return send(res, 200, r.rows);
  }

  if (req.method === 'POST' && p === '/api/presence') {
    const b = await readBody(req);
    const rows = (Array.isArray(b) ? b : [b]).slice(0, 31);
    const out = [];
    for (const r of rows) {
      const d = day(r.day);
      if (!d) continue;
      const q = await pool.query(
        `insert into hr_presence (person_id, day, location, person_name, team, updated_at)
         values ($1,$2,$3,$4,$5, now())
         on conflict (person_id, day) do update set location = excluded.location,
           person_name = excluded.person_name, team = excluded.team, updated_at = now()
         returning person_id, to_char(day,'YYYY-MM-DD') as day, location, person_name, team`,
        [need(r.person_id, 64), d, oneOf(str(r.location, 40), LOCATIONS, 'Dubai'),
         need(r.person_name, 80), need(r.team, 40)],
      );
      out.push(q.rows[0]);
    }
    return send(res, 200, out);
  }

  if (req.method === 'GET' && p === '/api/news') {
    const r = await pool.query('select * from hr_news order by created_at desc limit 80');
    return send(res, 200, r.rows);
  }

  if (req.method === 'POST' && p === '/api/news') {
    const b = await readBody(req);
    const kind = oneOf(str(b.kind, 20), ['promotion', 'achievement', 'event', 'meeting', 'news'], 'news');
    const r = await pool.query(
      `insert into hr_news (kind, title, body, team, location, starts_at, author_id, author_name)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [kind, need(b.title, 200), str(b.body, 4000), str(b.team, 40),
       b.location ? oneOf(str(b.location, 40), LOCATIONS, null) : null,
       b.starts_at ? new Date(b.starts_at) : null,
       str(b.author_id, 64), need(b.author_name, 80)],
    );
    return send(res, 200, r.rows[0]);
  }

  if (req.method === 'POST' && p === '/api/news-comments') {
    const b = await readBody(req);
    const r = await pool.query(
      `insert into hr_news_comments (news_id, body, author_name) values ($1,$2,$3) returning *`,
      [Number(b.news_id), need(b.body, 2000), need(b.author_name, 80)],
    );
    return send(res, 200, r.rows[0]);
  }

  return send(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  // Single page: any unknown path renders the app rather than 404-ing.
  const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'));
    return send(res, 200, html, { 'Content-Type': MIME['.html'] });
  }
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const cache = rel === 'index.html' ? 'no-store' : 'public, max-age=3600';
  return send(res, 200, fs.readFileSync(file), { 'Content-Type': type, 'Cache-Control': cache });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/health') return send(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await apiRoute(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error('[http]', req.method, url.pathname, '—', err.message);
    const bad = /missing field|invalid json|payload too large/.test(err.message);
    return send(res, bad ? 400 : 500, { error: bad ? err.message : 'server error' });
  }
});

migrate()
  .then(() => server.listen(PORT, () => console.log(`[hrhub] listening on ${PORT}`)))
  .catch((err) => { console.error('[db] migration failed:', err.message); process.exit(1); });
