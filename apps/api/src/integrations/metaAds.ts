/**
 * Meta Marketing API — READ ad performance (spend + results per ad / campaign),
 * so Eventana can see which Instagram ad is eating the budget and which brings the
 * cheapest results. Separate from integrations/attribution.ts (which SENDS Purchase
 * events via CAPI). No SDK — a thin fetch over the Graph API, like our other
 * adapters. A no-op (returns null) when no read token / ad account is configured
 * or the token lacks `ads_read`, so callers fall back to expenses-based spend.
 *
 * NOTE: Eventana's ads are click-to-WhatsApp, so Meta's measured "result" is a
 * messaging conversation started — NOT a booking (bookings live in our own data).
 * This gives the per-ad SPEND + conversation split; cost-per-BOOKING still comes
 * from finance_receipts (every booking is ad-driven — owner's standing fact).
 */
import { config } from '../config.js';

export function metaAdsEnabled(): boolean {
  return Boolean(config.meta.adsReadToken && config.meta.adAccountId);
}

export type AdInsight = {
  ad: string;
  campaign: string;
  spendAed: number;
  impressions: number;
  clicks: number;
  conversations: number; // messaging conversations started (click-to-WhatsApp result)
  costPerConversationAed: number | null;
};

/** Pull the messaging-conversation count out of Meta's `actions` array. */
function conversationsOf(actions: any): number {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find((a) =>
    typeof a?.action_type === 'string' &&
    /messaging_conversation_started|onsite_conversion\.messaging|link_click.*whatsapp/i.test(a.action_type),
  );
  // Prefer the explicit messaging conversation; else fall back to total messaging.
  const msg = actions.find((a) => a?.action_type === 'onsite_conversion.messaging_conversation_started_7d');
  const pick = msg ?? hit;
  return pick ? Math.round(Number(pick.value || 0)) : 0;
}

/**
 * Per-ad insights for a date preset (default this_month). Returns rows sorted by
 * spend (highest first), or null when disabled / the API refuses (logged).
 */
export async function fetchAdInsights(datePreset = 'this_month'): Promise<AdInsight[] | null> {
  if (!metaAdsEnabled()) return null;
  const base = `https://graph.facebook.com/${config.meta.graphVersion}`;
  const token = config.meta.adsReadToken as string;
  const acct = config.meta.adAccountId as string;
  const fields = 'ad_name,campaign_name,spend,impressions,clicks,actions';
  const url = `${base}/act_${acct}/insights?level=ad&date_preset=${encodeURIComponent(datePreset)}&fields=${encodeURIComponent(fields)}&limit=100&access_token=${encodeURIComponent(token)}`;
  try {
    const res = await fetch(url);
    const json = (await res.json()) as { data?: any[]; error?: { message?: string; code?: number; type?: string } };
    if (!res.ok || json.error) {
      console.error(`[meta-ads] insights ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
      return null;
    }
    const rows: AdInsight[] = (json.data ?? []).map((r) => {
      const spendAed = Math.round(Number(r.spend || 0));
      const conversations = conversationsOf(r.actions);
      return {
        ad: String(r.ad_name ?? '—'),
        campaign: String(r.campaign_name ?? '—'),
        spendAed,
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        conversations,
        costPerConversationAed: conversations > 0 ? Math.round((spendAed / conversations) * 10) / 10 : null,
      };
    });
    rows.sort((a, b) => b.spendAed - a.spendAed);
    return rows;
  } catch (err) {
    console.error('[meta-ads] insights request failed:', (err as Error).message);
    return null;
  }
}

/** Account-level roll-up for the preset (sum of the per-ad rows). */
export async function fetchAdSummary(datePreset = 'this_month'): Promise<{ spendAed: number; conversations: number; ads: number; costPerConversationAed: number | null; top: AdInsight[] } | null> {
  const rows = await fetchAdInsights(datePreset);
  if (!rows) return null;
  const spendAed = rows.reduce((s, r) => s + r.spendAed, 0);
  const conversations = rows.reduce((s, r) => s + r.conversations, 0);
  return {
    spendAed,
    conversations,
    ads: rows.length,
    costPerConversationAed: conversations > 0 ? Math.round((spendAed / conversations) * 10) / 10 : null,
    top: rows.slice(0, 5),
  };
}
