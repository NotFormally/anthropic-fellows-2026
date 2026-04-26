/**
 * invoice-vision-extractor.ts — Multimodal Claude for structured invoice extraction
 *
 * Demonstrates a production pattern for extracting line items from
 * images OR PDFs via Claude's vision + document capabilities.
 *
 * Key properties:
 *   1. Multimodal input (image or PDF via base64)
 *   2. Strict JSON output schema — no markdown, no prose
 *   3. Per-line AI confidence score — the model rates its own certainty
 *      on each extracted row (useful for triage: auto-accept >0.9,
 *      human-review 0.5–0.9, reject <0.5)
 *   4. Defense in depth: auth, rate limit, daily cost cap, canary prompt
 *      injection, output guard (see cost-tracker.ts for the cost cap)
 *   5. Robust response parsing with structured error path
 *
 * Downstream (not shown here): line items are passed through a
 * fuzzy-matching stage (Jaccard token similarity) to link against a
 * catalog of previously-seen items, with an auto-accept threshold and
 * a "suggest for manual review" threshold.
 */

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { logAiUsage, checkDailyCostCap, dailyCostCapExceeded } from './cost-tracker';

// ── Auth / rate-limit stubs (replace with your own in production) ──
//
// The production version of this route wraps these three layers around
// every AI call. They are sketched here as no-ops so the snippet is
// self-contained.

type Auth = {
  tenantId: string;
  userId: string;
  tier: 'free' | 'starter' | 'pro' | 'enterprise';
};

async function requireAuth(_req: NextRequest): Promise<Auth | null> {
  // Integrate with your auth provider (Supabase Auth, Clerk, Auth0...)
  return { tenantId: 'demo-tenant', userId: 'demo-user', tier: 'starter' };
}

function unauthorized() {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

async function checkRateLimit(
  _tenantId: string,
  _route: string,
  _tier: Auth['tier']
): Promise<{ allowed: boolean }> {
  // Wire to your rate limiter (Upstash, in-memory counter, Postgres...)
  return { allowed: true };
}

function tooManyRequests() {
  return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
}

// ── Prompt-injection defense (see below) ──

function injectCanary(prompt: string): string {
  // A canary is a stable, improbable token you add to the system prompt.
  // If the model's output repeats it, an injection attempted to exfiltrate
  // the prompt. Example: a rare phrase like "TRIPLE-PURPLE-7743".
  const CANARY = 'CANARY-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  (globalThis as { __lastCanary?: string }).__lastCanary = CANARY;
  return `${prompt}\n\n[internal:${CANARY}]`;
}

function guardOutput(text: string): { safe: boolean; flags: string[] } {
  const flags: string[] = [];
  const canary = (globalThis as { __lastCanary?: string }).__lastCanary;
  if (canary && text.includes(canary)) flags.push('canary_leak');
  // Add your own heuristics: URLs, PII patterns, base64 blobs, etc.
  return { safe: flags.length === 0, flags };
}

// ── Model ──

const MODEL = 'claude-sonnet-4-6';

// ── Anthropic client (lazy) ──

let _anthropic: Anthropic | null = null;
function getAnthropic() {
  if (!_anthropic) {
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });
  }
  return _anthropic;
}

// ── Route handler ──

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (!auth) return unauthorized();

    const rl = await checkRateLimit(auth.tenantId, 'extract-invoice', auth.tier);
    if (!rl.allowed) return tooManyRequests();

    const costCap = await checkDailyCostCap(auth.tenantId, auth.tier);
    if (!costCap.allowed) return dailyCostCapExceeded();

    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 500 }
      );
    }

    const { fileData, mediaType, isPdf } = await req.json();

    if (!fileData || !mediaType) {
      return NextResponse.json(
        { error: 'fileData and mediaType are required (base64)' },
        { status: 400 }
      );
    }

    const allowedMediaTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
    ];
    if (!allowedMediaTypes.includes(mediaType)) {
      return NextResponse.json({ error: 'Unsupported media type' }, { status: 400 });
    }
    // Base64 has ~33% overhead. 10 MB payload ≈ 7.5 MB decoded — safe upper bound.
    if (fileData.length > 10_000_000) {
      return NextResponse.json(
        { error: 'File too large (max ~7.5 MB decoded)' },
        { status: 413 }
      );
    }

    // Multimodal input block: either image or PDF document.
    const contentBlock = isPdf
      ? ({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf' as const,
            data: fileData,
          },
        } as Anthropic.DocumentBlockParam)
      : ({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mediaType as Anthropic.Base64ImageSource['media_type'],
            data: fileData,
          },
        } as Anthropic.ImageBlockParam);

    // System prompt: strict JSON out, with per-row AI self-confidence.
    const systemPrompt = `You are an invoice-extraction auditor. You analyze the provided invoice (image or PDF) and extract every line item with extreme precision.

Return JSON in the following shape. No markdown. No commentary. Only JSON.

{
  "supplier_name": "Supplier Name",
  "invoice_number": "Invoice number (or null)",
  "invoice_date": "YYYY-MM-DD",
  "total_amount": 120.50,
  "items": [
    {
      "raw_description": "Description exactly as written on the invoice",
      "quantity": 1.000,
      "unit": "LB | KG | EA | CASE | BOX | ...",
      "unit_price": 25.50,
      "total_price": 25.50,
      "ai_confidence": 0.95
    }
  ]
}

The "ai_confidence" field (0.00–1.00) MUST reflect how certain you are about the extraction for that specific row. Lower the score if the row is blurred, handwritten, crossed out, or if (quantity * unit_price) does not match total_price exactly.`;

    const aiStart = Date.now();
    const message = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 2500,
      system: injectCanary(systemPrompt),
      messages: [
        {
          role: 'user',
          content: [
            contentBlock,
            {
              type: 'text',
              text: 'Extract the invoice data in the requested JSON format.',
            },
          ],
        },
      ],
    });

    const responseText = (message.content[0] as { type: string; text: string }).text;

    const outputCheck = guardOutput(responseText);
    if (!outputCheck.safe) {
      console.warn('[invoice-extractor] Output guard triggered:', outputCheck.flags);
      // Depending on policy, you may also block or retry here.
    }

    logAiUsage({
      tenantId: auth.tenantId,
      userId: auth.userId,
      route: 'extract-invoice',
      model: MODEL,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      durationMs: Date.now() - aiStart,
      status: 'success',
      summary: 'Invoice OCR extraction',
    });

    try {
      const extractedData = JSON.parse(responseText.trim());
      return NextResponse.json(extractedData);
    } catch (parseError) {
      console.error('[invoice-extractor] Failed to parse JSON response:', responseText);
      return NextResponse.json(
        { error: 'AI response was not valid JSON', raw: responseText },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('[invoice-extractor] Extraction error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to process invoice',
      },
      { status: 500 }
    );
  }
}
