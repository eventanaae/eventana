/**
 * Re-read PENDING bank rows with Claude and correct fields that the old regex got
 * wrong (amount like 170→24, a status "Under Process" saved as the merchant, a
 * wrong date). Uses the stored raw_text as the source document. Anything Claude
 * isn't sure about is FLAGGED (⚠️ note) rather than guessed; a row that reads as
 * INWARD money is flagged too (the owner rejects it). Pending only — never an
 * approved expense. Guarded per REREAD_BANK_TAG; no-op without ANTHROPIC_API_KEY.
 */
import { pool } from './pool.js';
import { llmExtractTransaction } from '../domain/bankInbox.js';

const AED_PER_USD = 3.6725;

export async function reReadBankRowsFromEnv(): Promise<void> {
  if (String(process.env.RUN_MIGRATIONS_ON_BOOT ?? '').toLowerCase() !== 'true') return;
  const tag = process.env.REREAD_BANK_TAG ?? 'v1';
  const guard = await pool.query(`SELECT 1 FROM app_kv WHERE k = $1`, [`reread_bank_${tag}`]).catch(() => ({ rowCount: 0 }));
  if (guard.rowCount) return;
  const { anthropicEnabled } = await import('../integrations/anthropic.js');
  if (!anthropicEnabled()) { console.log('[reread-bank] ANTHROPIC_API_KEY not set — skipping'); return; }

  // Generic bank rows only — Anthropic/Tabby/Tamara have accurate dedicated parsers.
  const { rows } = await pool.query<{ id: string; merchant: string | null; raw_text: string | null; amount_fils: number }>(
    `SELECT id, merchant, raw_text, amount_fils FROM bank_transactions
      WHERE status = 'pending' AND source NOT IN ('anthropic','tabby','tamara')
      ORDER BY created_at DESC LIMIT 100`,
  );
  let corrected = 0, flagged = 0, unchanged = 0;
  for (const r of rows) {
    const llm = await llmExtractTransaction('', String(r.merchant ?? ''), String(r.raw_text ?? '')).catch(() => null);
    if (!llm || !llm.isTransaction) { unchanged++; continue; }
    const rate = (llm.currency ?? 'AED').toUpperCase() === 'USD' ? AED_PER_USD : 1;
    const newAmount = llm.amount != null ? Math.round(llm.amount * rate * 100) : Number(r.amount_fils);
    const newMerchant = llm.merchant ?? r.merchant;
    const flags: string[] = [];
    if (!llm.confident) flags.push(`auto-read may be wrong${llm.note ? `: ${llm.note}` : ''}`);
    if (llm.direction === 'credit') flags.push('looks like INWARD money (not an expense) — reject if so');
    const reviewNote = flags.length ? `⚠️ NEEDS REVIEW — ${flags.join('; ')}. Check amount, vendor & date.` : null;
    // Keep the rest of the stored raw after the first (note) line.
    const raw = String(r.raw_text ?? '');
    const nl = raw.indexOf('\n\n');
    const bodyPart = nl >= 0 ? raw.slice(nl) : `\n\n${raw}`;
    const newRaw = reviewNote ? (reviewNote + bodyPart).slice(0, 4000) : raw;
    await pool.query(
      `UPDATE bank_transactions
          SET amount_fils = $2,
              merchant = COALESCE(NULLIF($3,''), merchant),
              direction = $4,
              posted_on = COALESCE($5::date, posted_on),
              raw_text = $6
        WHERE id = $1 AND status = 'pending'`,
      [r.id, newAmount, String(newMerchant ?? ''), llm.direction ?? 'debit', llm.date, newRaw],
    );
    if (reviewNote) flagged++; else corrected++;
    console.log(`[reread-bank] ${r.id}: ${newMerchant ?? '—'} · AED ${(newAmount / 100).toFixed(2)} · ${llm.direction ?? 'debit'}${reviewNote ? ' · FLAGGED' : ''}`);
  }
  console.log(`[reread-bank] done: ${corrected} corrected, ${flagged} flagged, ${unchanged} unchanged (of ${rows.length})`);
  await pool.query(`INSERT INTO app_kv (k, v) VALUES ($1, now()) ON CONFLICT (k) DO NOTHING`, [`reread_bank_${tag}`]).catch(() => {});
}
