/**
 * orchestrator.ts — Minimal verifier/repair pattern for Claude agents
 *
 * Demonstrates a typed-contract orchestration pattern:
 *   1. Executor produces a candidate answer
 *   2. Verifier checks it against constraints (pure function or Claude call)
 *   3. If verification fails, repair loop with bounded attempts
 *   4. Fail closed after N attempts
 *
 * Pattern used in production for clinical-note classification, document
 * extraction, and structured output validation.
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── Types ──

export type VerificationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export type Verifier<T> = (candidate: T) => Promise<VerificationResult<T>>;

export type OrchestratorOptions<T> = {
  schema: z.ZodSchema<T>;
  systemPrompt: string;
  userPrompt: string;
  verifier: Verifier<T>;
  model?: string;
  maxAttempts?: number;
};

export type OrchestratorResult<T> =
  | { status: 'ship'; value: T; attempts: number }
  | { status: 'fail'; errors: string[]; attempts: number };

// ── Core Loop ──

/**
 * Run the executor → verifier → (repair?) → ship pattern.
 *
 * @example
 * ```ts
 * const TaskSchema = z.object({ priority: z.enum(['p0','p1','p2']), eta_hours: z.number() });
 *
 * const result = await orchestrate({
 *   schema: TaskSchema,
 *   systemPrompt: 'Classify the incoming issue.',
 *   userPrompt: issueDescription,
 *   verifier: async (c) => c.eta_hours > 0
 *     ? { ok: true, value: c }
 *     : { ok: false, errors: ['eta_hours must be positive'] },
 * });
 * ```
 */
export async function orchestrate<T>(
  opts: OrchestratorOptions<T>
): Promise<OrchestratorResult<T>> {
  const {
    schema,
    systemPrompt,
    userPrompt,
    verifier,
    model = 'claude-sonnet-4-6',
    maxAttempts = 3,
  } = opts;

  let lastErrors: string[] = [];
  let repairContext = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ── Executor: generate structured candidate ──
    const prompt = attempt === 1
      ? userPrompt
      : `${userPrompt}\n\n---\n\nPrevious attempt failed verification:\n${repairContext}\n\nFix the issues above and produce a corrected output.`;

    const response = await client.messages.create({
      model,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content
      .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
      .map((b) => b.text)
      .join('\n');

    // Extract JSON from response (handles code-fenced or plain)
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ?? text.match(/(\{[\s\S]*\})/);
    if (!jsonMatch) {
      lastErrors = ['Executor output did not contain JSON'];
      repairContext = `Your last response had no parseable JSON. Output ONLY JSON.`;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch (e) {
      lastErrors = [`JSON parse error: ${(e as Error).message}`];
      repairContext = lastErrors[0];
      continue;
    }

    // ── Schema validation (Zod) ──
    const schemaCheck = schema.safeParse(parsed);
    if (!schemaCheck.success) {
      lastErrors = schemaCheck.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
      repairContext = `Schema validation failed:\n${lastErrors.map((e) => `- ${e}`).join('\n')}`;
      continue;
    }

    // ── Verifier: domain-specific check ──
    const verify = await verifier(schemaCheck.data);
    if (verify.ok) {
      return { status: 'ship', value: verify.value, attempts: attempt };
    }

    lastErrors = verify.errors;
    repairContext = `Verifier rejected the candidate:\n${verify.errors.map((e) => `- ${e}`).join('\n')}`;
  }

  // Fail closed after maxAttempts
  return { status: 'fail', errors: lastErrors, attempts: maxAttempts };
}
