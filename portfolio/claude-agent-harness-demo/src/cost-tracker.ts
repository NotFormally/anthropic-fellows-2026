/**
 * cost-tracker.ts — Centralized Anthropic API Cost Tracker
 *
 * Logs every Claude API call with token accounting, cluster tagging,
 * and daily cost caps. Non-blocking inserts: never slow API responses.
 *
 * Anonymized from a production multi-tenant SaaS; generic tenant model.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Lazy Supabase Admin ──

let _admin: SupabaseClient | null = null;

function getAdmin(): SupabaseClient | null {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    _admin = createClient(url, key);
  }
  return _admin;
}

// ── Model Pricing (per million tokens, USD) — keep in sync with Anthropic pricing page ──

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['claude-sonnet-4-6'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

// ── Dev Session Cost Tracker ──

let _sessionCostUsd = 0;
let _sessionCalls = 0;

// ── Subscription Tiers + Daily Cost Caps ──

export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'enterprise';

const DAILY_COST_CAPS: Record<SubscriptionTier, number> = {
  free: 1.0,
  starter: 10.0,
  pro: 25.0,
  enterprise: 50.0,
};

// ── Route → Functional Cluster (tenant-specific in production — example here) ──

const ROUTE_CLUSTER: Record<string, string> = {
  analyze: 'ingest',
  extract: 'ingest',
  summarize: 'reduce',
  classify: 'reduce',
  draft: 'generate',
};

// ── Types ──

export type AiLogEntry = {
  tenantId: string;
  userId?: string;
  route: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  status?: 'success' | 'error' | 'blocked';
  durationMs?: number;
  summary?: string;
  metadata?: Record<string, unknown>;
};

// ── Core Logger ──

/**
 * Log an AI API call. Non-blocking — returns immediately.
 *
 * @example
 * ```ts
 * const start = Date.now();
 * const { object, usage } = await generateObject({ model, ... });
 * logAiUsage({
 *   tenantId: auth.tenantId,
 *   userId: auth.user.id,
 *   route: 'analyze',
 *   model: 'claude-sonnet-4-6',
 *   inputTokens: usage.promptTokens,
 *   outputTokens: usage.completionTokens,
 *   durationMs: Date.now() - start,
 *   summary: 'Analyzed document: contract extraction',
 * });
 * ```
 */
export function logAiUsage(entry: AiLogEntry): void {
  const admin = getAdmin();
  if (!admin) {
    console.warn('[cost-tracker] No service role key — skipping log');
    return;
  }

  const cluster = ROUTE_CLUSTER[entry.route] ?? 'generate';
  const costUsd = calculateCost(entry.model, entry.inputTokens, entry.outputTokens);

  if (process.env.NODE_ENV === 'development') {
    _sessionCalls++;
    _sessionCostUsd += costUsd;
    const tokens = entry.inputTokens + entry.outputTokens;
    console.log(
      `\x1b[33m[ai-cost]\x1b[0m $${costUsd.toFixed(4)} | ${entry.route} (${entry.model}, ${tokens} tok) | ` +
      `Session: \x1b[1m$${_sessionCostUsd.toFixed(2)}\x1b[0m (${_sessionCalls} calls)`
    );
    if (_sessionCostUsd >= 5) {
      console.warn(
        `\x1b[31m[ai-cost] ⚠ Session cost exceeded $5 — currently $${_sessionCostUsd.toFixed(2)}\x1b[0m`
      );
    }
  }

  // Fire-and-forget — never blocks the response
  Promise.resolve(
    admin.from('ai_usage_logs').insert({
      tenant_id: entry.tenantId,
      user_id: entry.userId ?? null,
      route: entry.route,
      model: entry.model,
      cluster,
      input_tokens: entry.inputTokens,
      output_tokens: entry.outputTokens,
      cost_usd: costUsd,
      status: entry.status ?? 'success',
      duration_ms: entry.durationMs ?? null,
      summary: entry.summary ?? null,
      metadata: entry.metadata ?? {},
    })
  )
    .then((result) => {
      if (result.error) console.error('[cost-tracker] Insert failed:', result.error.message);
    })
    .catch((err) => {
      console.error('[cost-tracker] Unexpected error:', err);
    });
}

// ── Daily Cost Cap Check ──

export type CostCapResult = {
  allowed: boolean;
  dailyCostSoFar: number;
  dailyCap: number;
  remaining: number;
};

/**
 * Check if a tenant has exceeded its daily AI cost cap.
 * Aggregates cost_usd from ai_usage_logs for the past 24 hours.
 * Call BEFORE making an AI call; return 429 if not allowed.
 */
export async function checkDailyCostCap(
  tenantId: string,
  tier: SubscriptionTier = 'starter'
): Promise<CostCapResult> {
  const admin = getAdmin();
  const cap = DAILY_COST_CAPS[tier] ?? DAILY_COST_CAPS.starter;

  if (!admin) {
    console.warn('[cost-tracker] No service role key — skipping cost cap check');
    return { allowed: true, dailyCostSoFar: 0, dailyCap: cap, remaining: cap };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from('ai_usage_logs')
    .select('cost_usd')
    .eq('tenant_id', tenantId)
    .gte('created_at', since);

  if (error) {
    console.error('[cost-tracker] Cost cap check failed:', error.message);
    // Fail open — don't block legitimate users due to DB issues
    return { allowed: true, dailyCostSoFar: 0, dailyCap: cap, remaining: cap };
  }

  const dailyCostSoFar = (data ?? []).reduce(
    (sum, row) => sum + (Number(row.cost_usd) || 0),
    0
  );

  const remaining = Math.max(0, cap - dailyCostSoFar);

  return {
    allowed: dailyCostSoFar < cap,
    dailyCostSoFar,
    dailyCap: cap,
    remaining,
  };
}

/** Standard 429 response for daily cost cap exceeded. */
export function dailyCostCapExceeded() {
  return new Response(
    JSON.stringify({
      error: 'Daily cost cap reached. Retry tomorrow or upgrade tier.',
      code: 'DAILY_COST_CAP_EXCEEDED',
    }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' },
    }
  );
}
