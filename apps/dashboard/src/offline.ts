/**
 * Offline support for the staff app.
 *
 *  • Read cache — every successful GET is saved on the device (IndexedDB). When
 *    the phone has no internet, the app serves the last saved copy instead of a
 *    blank "Can't reach the engine" screen, and shows when it was last updated.
 *  • Outbox — a short allow-list of safe staff actions (prep task done / status /
 *    checklist, damage + missing-item reports, task photos) is queued on the
 *    device while offline and sent automatically, in order, once the phone is
 *    back online. Nothing that touches money is ever queued.
 *
 * Every entry is tagged with the session token it was made under: the cache is
 * only read back under that same login, and a queued action is replayed with
 * the token of the person who did it (never whoever is signed in later).
 */

const DB_NAME = 'eventana-offline';
const DB_VERSION = 1;
const CACHE_STORE = 'cache';
const OUTBOX_STORE = 'outbox';
// A saved copy older than this is too stale to be useful — drop it.
const CACHE_MAX_AGE_MS = 14 * 86400_000;
// Very large responses (owner finance exports etc.) aren't worth saving.
const CACHE_MAX_CHARS = 2_000_000;

let dbPromise: Promise<IDBDatabase | null> | null = null;
function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') return resolve(null);
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(CACHE_STORE)) d.createObjectStore(CACHE_STORE, { keyPath: 'key' });
          if (!d.objectStoreNames.contains(OUTBOX_STORE)) d.createObjectStore(OUTBOX_STORE, { keyPath: 'id', autoIncrement: true });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch { resolve(null); }
    });
  }
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return db().then((d) => new Promise<T | null>((resolve) => {
    if (!d) return resolve(null);
    try {
      const t = d.transaction(store, mode);
      const r = fn(t.objectStore(store));
      t.oncomplete = () => resolve(r ? (r.result as T) : null);
      t.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch { resolve(null); }
  }));
}

/* ── connection state (drives the banner) ──────────────────────────────────── */

export interface OfflineState {
  offline: boolean;
  /** When the saved data currently on screen was fetched (ms), if serving cache. */
  dataAsOf: number | null;
  /** Actions waiting on this device to be sent. */
  pending: number;
  /** True while the outbox is being sent. */
  syncing: boolean;
}

let state: OfflineState = { offline: typeof navigator !== 'undefined' && navigator.onLine === false, dataAsOf: null, pending: 0, syncing: false };
const listeners = new Set<(s: OfflineState) => void>();
function setState(patch: Partial<OfflineState>): void {
  const next = { ...state, ...patch };
  if (next.offline === state.offline && next.dataAsOf === state.dataAsOf && next.pending === state.pending && next.syncing === state.syncing) return;
  state = next;
  listeners.forEach((fn) => fn(state));
}
export function getOfflineState(): OfflineState { return state; }
export function subscribeOffline(fn: (s: OfflineState) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** The browser says there is no network at all — don't even try a request. */
export function deviceOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function markOnline(): void {
  if (state.offline) setState({ offline: false, dataAsOf: null });
}
export function markOffline(dataAsOf: number | null): void {
  // Show the OLDEST saved copy in use, so "last updated" never overstates freshness.
  const asOf = dataAsOf == null ? state.dataAsOf : state.dataAsOf == null ? dataAsOf : Math.min(state.dataAsOf, dataAsOf);
  setState({ offline: true, dataAsOf: asOf });
}

/* ── read cache ────────────────────────────────────────────────────────────── */

interface CacheEntry { key: string; token: string; at: number; body: unknown }

export async function cachePut(path: string, token: string, body: unknown): Promise<void> {
  try {
    if (JSON.stringify(body).length > CACHE_MAX_CHARS) return;
  } catch { return; }
  await tx(CACHE_STORE, 'readwrite', (s) => s.put({ key: path, token, at: Date.now(), body } satisfies CacheEntry));
}

/** The saved copy of a GET, only if it was saved under this same login. */
export async function cacheGet(path: string, token: string): Promise<{ at: number; body: unknown } | null> {
  const e = await tx<CacheEntry | undefined>(CACHE_STORE, 'readonly', (s) => s.get(path));
  if (!e || e.token !== token || Date.now() - e.at > CACHE_MAX_AGE_MS) return null;
  return { at: e.at, body: applyPendingToBody(e.body, pendingOps) };
}

/**
 * Wipe the saved copies on this device (sign-out). Unsent changes are KEPT:
 * each carries its own author's token, so work done offline still reaches the
 * server (as that person) instead of being lost by a sign-out.
 */
export async function clearOfflineData(): Promise<void> {
  await tx(CACHE_STORE, 'readwrite', (s) => s.clear());
  setState({ dataAsOf: null });
}

async function pruneCache(): Promise<void> {
  const all = await tx<CacheEntry[]>(CACHE_STORE, 'readonly', (s) => s.getAll());
  const stale = (all ?? []).filter((e) => Date.now() - e.at > CACHE_MAX_AGE_MS).map((e) => e.key);
  if (stale.length) await tx(CACHE_STORE, 'readwrite', (s) => { stale.forEach((k) => s.delete(k)); });
}

/* ── outbox ────────────────────────────────────────────────────────────────── */

/**
 * Plain JSON actions the outbox may hold. Anything not matched here is never
 * queued — it fails with "needs internet" as before. Kept deliberately narrow:
 * each one is the staff member's own field work, and none involves money.
 */
const QUEUEABLE: Array<{ method: string; re: RegExp }> = [
  { method: 'POST', re: /^\/api\/admin\/prep\/task\/[^/]+\/(complete|status|checklist)$/ },
  { method: 'POST', re: /^\/api\/admin\/inventory\/[^/]+\/report$/ },
  { method: 'POST', re: /^\/api\/admin\/missing-items$/ },
  { method: 'PATCH', re: /^\/api\/admin\/tasks\/\d+$/ },
];
export function isQueueable(method: string, path: string): boolean {
  const m = method.toUpperCase();
  return QUEUEABLE.some((q) => q.method === m && q.re.test(path));
}

export type OutboxItem =
  | { id?: number; kind: 'json'; token: string; at: number; method: string; path: string; body: string | null }
  // A photo taken offline: upload it first, then POST its URL to `path` as `field`.
  | { id?: number; kind: 'photo'; token: string; at: number; path: string; folder: string; field: string; extra: Record<string, unknown>; file: Blob; fileName: string };

// What's queued, kept in memory so saved copies can show it (a task the
// employee ticked offline must stay ticked when the list reloads).
let pendingOps: OutboxItem[] = [];

export async function enqueue(item: OutboxItem): Promise<void> {
  const saved = await tx(OUTBOX_STORE, 'readwrite', (s) => s.add(item));
  if (saved == null) throw new Error('This phone could not save the change offline — please try again with internet.');
  await refreshPending();
}

async function refreshPending(): Promise<void> {
  const all = await tx<OutboxItem[]>(OUTBOX_STORE, 'readonly', (s) => s.getAll());
  pendingOps = all ?? [];
  setState({ pending: pendingOps.length });
}

/**
 * Overlay queued prep-task changes onto a saved response, so the screen shows
 * what the employee already did. Prep task rows are recognised by having an
 * id + status + category (the shape every prep endpoint returns).
 */
function applyPendingToBody(body: unknown, ops: OutboxItem[]): unknown {
  const changes = ops.map(prepChange).filter((c): c is PrepChange => !!c);
  if (!changes.length) return body;
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out: any = {};
    for (const k of Object.keys(v)) out[k] = walk(v[k]);
    if ('id' in out && 'status' in out && 'category' in out) {
      for (const c of changes) if (String(out.id) === c.taskId) applyPrep(out, c);
    }
    return out;
  };
  return walk(body);
}

type PrepChange = { taskId: string; op: 'complete' | 'status' | 'checklist'; body: any };
function prepChange(item: OutboxItem): PrepChange | null {
  const m = item.path.match(/^\/api\/admin\/prep\/task\/([^/]+)\/(complete|status|checklist)$/);
  if (!m) return null;
  let body: any = {};
  if (item.kind === 'json') { try { body = item.body ? JSON.parse(item.body) : {}; } catch { body = {}; } }
  return { taskId: decodeURIComponent(m[1]), op: m[2] as PrepChange['op'], body };
}
function applyPrep(t: any, c: PrepChange): void {
  if (c.op === 'complete') { t.status = 'completed'; t.notes = null; }
  else if (c.op === 'status') { t.status = c.body.status; if (c.body.note) t.notes = c.body.note; }
  else if (c.op === 'checklist' && Array.isArray(t.checklist)) {
    const i = Number(c.body.index);
    if (t.checklist[i] && typeof t.checklist[i] === 'object') t.checklist[i] = { ...t.checklist[i], done: !!c.body.done };
  }
}

/**
 * Send everything queued, oldest first. `send` does the real request and
 * returns 'ok', 'drop' (the server refused it for good — e.g. the task was
 * deleted) or 'retry' (still no connection / server busy — stop, try later).
 */
let flushing = false;
export async function flushOutbox(
  send: (item: OutboxItem) => Promise<{ result: 'ok' | 'drop' | 'retry'; message?: string }>,
): Promise<{ sent: number; failed: string[] }> {
  const failed: string[] = [];
  let sent = 0;
  if (flushing) return { sent, failed };
  flushing = true;
  try {
    const items = (await tx<OutboxItem[]>(OUTBOX_STORE, 'readonly', (s) => s.getAll())) ?? [];
    if (!items.length) return { sent, failed };
    setState({ syncing: true });
    for (const item of items) {
      const r = await send(item);
      if (r.result === 'retry') break;
      if (r.result === 'drop') failed.push(r.message ?? 'A change could not be saved.');
      else sent++;
      await tx(OUTBOX_STORE, 'readwrite', (s) => s.delete(item.id!));
    }
    return { sent, failed };
  } finally {
    flushing = false;
    await refreshPending();
    setState({ syncing: false });
  }
}

// Load the queue count on start and drop very old saved copies.
refreshPending();
pruneCache();
