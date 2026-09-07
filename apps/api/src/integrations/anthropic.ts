/**
 * Claude (Anthropic Messages API) — a thin adapter over the REST endpoint, no
 * SDK dependency (the build is `npm ci` with no new packages, exactly like the
 * email/whatsapp adapters). Used to write short, on-brand text — currently the
 * personalised Google-review replies. When ANTHROPIC_API_KEY is unset the whole
 * thing is a graceful no-op (returns null) so the caller falls back to templates.
 */
import { config } from '../config.js';

export function anthropicEnabled(): boolean {
  return Boolean(config.anthropic.apiKey);
}

/**
 * Generate a short piece of text. Returns the model's plain-text answer, or null
 * if Claude isn't configured or the call fails — the caller decides the fallback.
 * Deliberately minimal (model + max_tokens + system + one user message) so it
 * works on whatever model ANTHROPIC_MODEL names, cheap or flagship.
 */
export async function generateText(args: {
  system: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string | null> {
  if (!config.anthropic.apiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': config.anthropic.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.anthropic.model,
        max_tokens: args.maxTokens ?? 400,
        system: args.system,
        messages: [{ role: 'user', content: args.prompt }],
      }),
    });
    if (!res.ok) {
      console.error(`[anthropic] ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    // The response is a list of content blocks; take the text block(s). Thinking
    // blocks (if the model returns any) carry no `text` and are skipped.
    const text = (json.content ?? [])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('')
      .trim();
    return text || null;
  } catch (err) {
    console.error('[anthropic] request failed:', (err as Error).message);
    return null;
  }
}
