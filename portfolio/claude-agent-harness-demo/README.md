# claude-agent-harness-demo

Production patterns for Anthropic Claude, extracted and anonymized from a
multi-tenant TypeScript/Next.js/Supabase SaaS. Four standalone files, each
demonstrating a specific pattern:

1. **`orchestrator.ts`** — verifier/repair loop with typed contracts
2. **`cost-tracker.ts`** — multi-tenant AI usage logging + daily cost caps
3. **`invoice-vision-extractor.ts`** — multimodal (image + PDF) extraction
   with per-row AI self-confidence scoring and defense-in-depth safety
4. **`prompt-guard.ts`** — multi-layer prompt injection defense (170+
   bilingual EN/FR rules, canary tokens, Unicode/structural detection)

## What's inside

### `src/orchestrator.ts` — Verifier/repair pattern

A minimal reference implementation of a bounded-retry orchestration loop:

1. **Executor** — Claude generates a structured candidate (JSON) from a
   user prompt and a typed schema.
2. **Schema validation** — Zod checks the shape before any domain logic runs.
3. **Verifier** — A pure function or another Claude call checks the candidate
   against business constraints (e.g., "ETA must be positive", "score must
   reference ≥2 citations").
4. **Repair** — If verification fails, the failing errors are fed back into
   the next executor prompt for targeted correction.
5. **Fail closed** — After `maxAttempts` retries, returns structured errors
   rather than silently shipping a bad output.

```ts
import { orchestrate } from './orchestrator';
import { z } from 'zod';

const TriageSchema = z.object({
  priority: z.enum(['p0', 'p1', 'p2']),
  eta_hours: z.number().positive(),
  rationale: z.string().min(20),
});

const result = await orchestrate({
  schema: TriageSchema,
  systemPrompt: 'You triage incoming support tickets.',
  userPrompt: ticketBody,
  verifier: async (c) =>
    c.rationale.includes('user impact')
      ? { ok: true, value: c }
      : { ok: false, errors: ["rationale must mention 'user impact'"] },
});

if (result.status === 'ship') {
  await writeToQueue(result.value);
} else {
  await flagForHumanReview({ errors: result.errors, attempts: result.attempts });
}
```

### `src/cost-tracker.ts` — Multi-tenant AI usage logging

A pattern for tracking Claude API cost per tenant with **per-tier daily caps**
to prevent runaway spend in a public-facing SaaS:

- Fire-and-forget `logAiUsage()` — never blocks the API response
- Per-call cost calculation from token counts and model pricing
- Dev-mode session cost printer (terminal-visible running total)
- `checkDailyCostCap()` — gates expensive requests against a 24h rolling window
- Fail-open on DB errors — never lock legitimate users out due to infrastructure issues

Schema expected (Postgres / Supabase):

```sql
create table ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid,
  route text not null,
  model text not null,
  cluster text,
  input_tokens int not null,
  output_tokens int not null,
  cost_usd numeric not null,
  status text default 'success',
  duration_ms int,
  summary text,
  metadata jsonb,
  created_at timestamptz default now()
);

create index on ai_usage_logs (tenant_id, created_at desc);
```

### `src/invoice-vision-extractor.ts` — Multimodal extraction with self-confidence

A Next.js route handler that accepts an image or a PDF (as base64), sends
it to Claude's vision/document endpoint, and returns a structured JSON
invoice with a **per-line AI confidence score** the model assigns to its
own extraction.

Notable properties for AI-safety-adjacent work:

- **Self-rated confidence per row.** The model scores how certain it is
  about each extracted line (0.00–1.00). Downstream logic can then
  auto-accept high-confidence rows, route medium-confidence rows to a
  human reviewer, and reject low-confidence rows — turning a single
  calibration signal into a triage policy.
- **Defense in depth before any model call.** Auth → rate limit →
  daily cost cap → canary token injection → model call → output guard.
  Cost caps and canary checks run on every call, not just at tax time.
- **Canary-based injection detection.** A rare random token is embedded
  in the system prompt; if the model's output contains it, an attempt
  to exfiltrate the prompt is flagged.
- **Strict JSON contract.** The system prompt explicitly forbids
  markdown, prose, or commentary. Parse errors return a structured
  `{ error, raw }` so the caller can inspect what went wrong.
- **Multimodal.** Handles `image/jpeg`, `image/png`, `image/gif`,
  `image/webp`, and `application/pdf` via a single content-block branch.

```ts
// Request body (base64-encoded file + media type)
{
  "fileData": "JVBERi0xLjQK...",  // base64
  "mediaType": "application/pdf",
  "isPdf": true
}

// Response
{
  "supplier_name": "Acme Parts Co.",
  "invoice_number": "INV-2026-0417",
  "invoice_date": "2026-04-17",
  "total_amount": 1284.50,
  "items": [
    {
      "raw_description": "M6 stainless hex bolts, 20mm, box of 100",
      "quantity": 5,
      "unit": "BOX",
      "unit_price": 12.40,
      "total_price": 62.00,
      "ai_confidence": 0.97
    },
    {
      "raw_description": "[handwritten, partially crossed out]",
      "quantity": 1,
      "unit": "EA",
      "unit_price": 84.00,
      "total_price": 84.00,
      "ai_confidence": 0.42
    }
  ]
}
```

A production deployment adds a downstream fuzzy-matching stage (Jaccard
token similarity) that links extracted rows to a catalog of previously
seen items, with an auto-accept threshold and a "suggest for manual
review" threshold. That stage is out of scope here to keep the snippet
focused on the extraction/confidence layer.

### `src/prompt-guard.ts` — Multi-layer prompt injection defense

A guard middleware that sits in front of any LLM call. Six layers in one
pass:

1. **Length** — reject absurdly long inputs.
2. **Pattern detection** — 170+ bilingual rules (EN + FR), grouped by
   attack family: DPI (direct prompt injection), GH (goal hijack), DE
   (data exfiltration), JB (jailbreak), IPI (indirect prompt injection),
   MS (multi-stage), OM (output manipulation). Each rule has a numeric
   ID and a severity weight; total score caps at 100.
3. **Unicode / encoding tricks** — zero-width chars, RTL overrides,
   homoglyph mixed-script detection, Unicode tag characters in the
   supplementary plane (`\u{E0001}–\u{E007F}`).
4. **Structural injection** — markdown headings, XML-like `<system>`
   tags, delimiter escapes (`---` followed by "new instructions"),
   triple-backtick context-break attempts.
5. **Density heuristic** — high special-char-to-alphanumeric ratio
   on long inputs (catches obfuscated payloads).
6. **Canary tokens** — random tokens injected into the system prompt;
   their appearance in the model's output signals a successful
   exfiltration attempt. `guardOutput()` runs after the model call and
   flags canary leaks, env-var-shaped strings, and SQL-in-output.

```ts
import { quickGuard, injectCanary, guardOutput } from './prompt-guard';

export async function POST(req: Request) {
  const { note } = await req.json();
  const blocked = quickGuard(note, 'analyze-note');
  if (blocked) return blocked;

  const response = await claude.messages.create({
    system: injectCanary(SYSTEM_PROMPT),
    messages: [{ role: 'user', content: note }],
  });

  const out = response.content[0].text;
  const verdict = guardOutput(out);
  if (!verdict.safe) {
    // Canary leaked, env var pattern, or SQL detected — refuse to return.
    return Response.json({ error: 'output_blocked', flags: verdict.flags }, { status: 502 });
  }

  return Response.json({ result: out });
}
```

Pattern IDs (e.g. `DPI-006`, `GH-001`) are tracked across two empirical
rounds: a baseline pass plus a "Round 2" of patterns added after observing
real bypasses. Keeping the rule IDs visible in flags makes regression
debugging trivial — when a flag appears, you know exactly which test case
covers it.

## Why these patterns

- **Verifier/repair** isolates "what a correct answer looks like" from
  "how the model produces it" — lets you change prompts without re-auditing
  your acceptance criteria, and vice versa. In production, it also turns
  intermittent model failures into retries rather than silent bad writes.
- **Cost tracking at call-site**, not at invoice-time, means you can block
  abuse before it hits your Anthropic bill and expose accurate usage data
  to customers without screen-scraping the console.
- **Per-row self-confidence** gives you a triage knob without having to
  build a separate classifier. It's a cheap way to route ambiguous
  extractions to humans while letting clean rows flow straight through.
- **Prompt-guard at the route boundary** keeps adversarial-input handling
  out of the prompt itself. Routing decisions (block, warn, sanitize)
  live with the HTTP handler, not with the model — easier to test, easier
  to swap models, easier to maintain a regression corpus per flag ID.

## Provenance

Anonymized from a production TypeScript/Next.js/Supabase SaaS. Domain-specific
logic (route names, business rules, tenant-type labels) has been replaced with
generic examples. Patterns and control flow are preserved.

## Install

```bash
npm install
cp .env.example .env.local  # add your Anthropic + Supabase keys
```

## License

MIT
