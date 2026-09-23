/**
 * One-shot: seed the owner's personal task list (focus_tasks) with the remaining
 * backlog items so she can track & tick them off on the new "My Tasks" page.
 * Gated SEED_OWNER_TASKS=true. Idempotent by title (an item already present —
 * open OR done — is never re-added), so re-running is safe. Turn the flag off
 * after it runs so items she deletes don't come back.
 */
import { pool } from './pool.js';

// Ordered; the leading tag groups them visually on the page:
//   🔒 waiting on someone else · 🛠️ ready to build · ⚙️ finance clean-up · ❓ decision
const TASKS: string[] = [
  // Waiting on a third party or on the owner
  '🔒 Tabby: go live + add the Eventana merchant page (waiting on Tabby QA)',
  '🔒 Tamara: auto-capture the processor fees (waiting on the first settlement report)',
  '🔒 Google review auto-replies: switch on (needs Google OAuth approval)',
  '🔒 Arabic catalogue translation: review my draft & approve',
  '🔒 Product descriptions (168 items): review & approve to show on receipts',
  // Ready to build now
  '🛠️ Review every refund — quality issue vs customer cancellation',
  '🛠️ Clearer cancel/refund flow in Orders',
  '🛠️ Auto salary payment',
  '🛠️ Auto-post an Instagram story',
  '🛠️ Auto-post a WhatsApp story',
  '🛠️ Vehicle registration & insurance renewal reminders',
  '🛠️ Traffic fines (مخالفات) integration',
  '🛠️ Salik integration',
  '🛠️ Auto design & concept → email the customer (take over Marsha’s tasks)',
  '🛠️ Employee handbook + company policy',
  '🛠️ Customer auto-reply bot (WhatsApp/chat) — HIGH',
  '🛠️ Glam Dolls customer product',
  '🛠️ New products: kiosks (أكشاك), perfumes, lipstick',
  '🛠️ Add photos to every product & package',
  '🛠️ Employee training system & schedule',
  '🛠️ Inventory count on an all-present day',
  // Finance clean-up
  '⚙️ Task “problem” not clearing after the task is completed — investigate',
  '⚙️ Review & clean the “unpaid orders” (AED 63,025 / 19)',
  '⚙️ Fix historical paid-with Cash → Debit',
  '⚙️ Explain the phone-number health report',
  '⚙️ Safely merge duplicate customers',
  '⚙️ ETA auto-calc (needs the Google Maps key)',
  // Decision
  '❓ Apple Wallet ticket: enable or remove?',
];

export async function seedOwnerTasksFromEnv(): Promise<void> {
  if (String(process.env.SEED_OWNER_TASKS ?? '').toLowerCase() !== 'true') return;

  // The single active owner (matches focusMemberId's owner fallback).
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM team_members WHERE access_level = 'owner' AND active`,
  );
  if (rows.length !== 1) {
    console.log(`[seed-owner-tasks] expected exactly 1 active owner, found ${rows.length} — aborted`);
    return;
  }
  const memberId = rows[0].id;
  console.log(`[seed-owner-tasks] owner ${rows[0].name}=${memberId}`);

  // Existing titles (open OR done) so we never duplicate.
  const existing = await pool.query<{ title: string }>(
    `SELECT title FROM focus_tasks WHERE member_id = $1`,
    [memberId],
  );
  const have = new Set(existing.rows.map((r) => r.title));

  // Next sort_order after whatever open tasks already exist.
  const maxRes = await pool.query<{ m: number | null }>(
    `SELECT MAX(sort_order) AS m FROM focus_tasks WHERE member_id = $1 AND NOT done`,
    [memberId],
  );
  let sort = (maxRes.rows[0].m == null ? -1 : Number(maxRes.rows[0].m)) + 1;

  let added = 0;
  for (const title of TASKS) {
    if (have.has(title)) continue;
    await pool.query(
      `INSERT INTO focus_tasks (member_id, title, sort_order) VALUES ($1, $2, $3)`,
      [memberId, title, sort++],
    );
    added++;
  }
  console.log(`[seed-owner-tasks] added ${added} of ${TASKS.length} tasks (${TASKS.length - added} already present)`);
}
