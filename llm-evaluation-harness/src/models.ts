// =============================================================================
// Unified model interface for Claude, GPT, and Gemini.
//
// Goals:
//   - One function signature for all three providers, so the harness does not
//     branch on provider in its main loop.
//   - Lazy client initialisation so missing keys do not crash the import —
//     the harness can run with one or two providers configured.
//   - Bounded retry on transient errors (rate limit, 5xx, network), with
//     exponential backoff. Non-retryable errors (auth, bad request) bubble
//     up immediately so the caller can fail fast.
//   - Configurable model IDs via env, with sensible defaults pinned to the
//     most capable production model in each family at the time of writing.
// =============================================================================

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';

import type { ModelId } from './types.js';

// ---------------------------------------------------------------------------
// Defaults — overridable via env or per-call options.
// ---------------------------------------------------------------------------

const DEFAULT_CLAUDE_MODEL = 'claude-opus-4-7-20251201';
const DEFAULT_OPENAI_MODEL = 'gpt-5';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.2;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 750;

/**
 * Per-call options. Every field is optional; sensible defaults apply.
 */
export type GenerateOptions = {
  /** Override the default model ID for this provider. */
  modelOverride?: string;
  /** Sampling temperature. Defaults to 0.2 (low, since we want consistent eval). */
  temperature?: number;
  /** Output token cap. Defaults to 1024. */
  maxTokens?: number;
};

/**
 * Generate a completion from a named provider with a system prompt and a
 * single user message. Returns the raw response text.
 *
 * @param model     One of `'claude' | 'gpt' | 'gemini'`.
 * @param systemPrompt The system / instruction prompt.
 * @param userMessage The user-facing message to send.
 * @param options   Per-call overrides.
 * @throws if the requested provider has no API key configured, or if the
 *   call fails after all retries.
 */
export async function generateCompletion(
  model: ModelId,
  systemPrompt: string,
  userMessage: string,
  options: GenerateOptions = {},
): Promise<string> {
  switch (model) {
    case 'claude':
      return callWithRetry(() => callClaude(systemPrompt, userMessage, options));
    case 'gpt':
      return callWithRetry(() => callOpenAI(systemPrompt, userMessage, options));
    case 'gemini':
      return callWithRetry(() => callGemini(systemPrompt, userMessage, options));
    default: {
      const exhaustive: never = model;
      throw new Error(`Unknown model id: ${String(exhaustive)}`);
    }
  }
}

/**
 * Returns the list of model IDs that have an API key configured in the
 * current environment. Useful at startup to skip providers gracefully.
 */
export function availableModels(): ModelId[] {
  const out: ModelId[] = [];
  if (process.env.ANTHROPIC_API_KEY) out.push('claude');
  if (process.env.OPENAI_API_KEY) out.push('gpt');
  if (process.env.GEMINI_API_KEY) out.push('gemini');
  return out;
}

// ---------------------------------------------------------------------------
// Provider-specific implementations. Each one is responsible for translating
// the unified contract into the provider's native shape.
// ---------------------------------------------------------------------------

let anthropicClient: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!anthropicClient) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('ANTHROPIC_API_KEY is not set');
    }
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  options: GenerateOptions,
): Promise<string> {
  const client = getAnthropic();
  const modelId =
    options.modelOverride ?? process.env.CLAUDE_MODEL ?? DEFAULT_CLAUDE_MODEL;

  const response = await client.messages.create({
    model: modelId,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  // Concatenate all text blocks. The Anthropic SDK may return multiple
  // content blocks; tool-use blocks would have type 'tool_use', which we
  // ignore here since this harness uses plain text completions.
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    openaiClient = new OpenAI({ apiKey: key });
  }
  return openaiClient;
}

async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  options: GenerateOptions,
): Promise<string> {
  const client = getOpenAI();
  const modelId =
    options.modelOverride ?? process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;

  const response = await client.chat.completions.create({
    model: modelId,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned empty content');
  }
  return text.trim();
}

let geminiClient: GoogleGenerativeAI | null = null;
function getGemini(): GoogleGenerativeAI {
  if (!geminiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY is not set');
    }
    geminiClient = new GoogleGenerativeAI(key);
  }
  return geminiClient;
}

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  options: GenerateOptions,
): Promise<string> {
  const client = getGemini();
  const modelId =
    options.modelOverride ?? process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;

  const model = client.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      maxOutputTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
  });

  const result = await model.generateContent(userMessage);
  const text = result.response.text();
  if (!text) {
    throw new Error('Gemini returned empty content');
  }
  return text.trim();
}

// ---------------------------------------------------------------------------
// Retry helper.
// ---------------------------------------------------------------------------

/**
 * Run a callable with exponential-backoff retry on transient errors.
 * Non-retryable errors (auth, bad request) bubble up on the first attempt.
 */
async function callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS) {
        throw err;
      }
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      await sleep(backoff);
    }
  }
  // Unreachable in practice — the loop either returns or throws.
  throw lastError instanceof Error
    ? lastError
    : new Error('callWithRetry exhausted attempts');
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('429')) return true;
    if (msg.includes('timeout') || msg.includes('etimedout')) return true;
    if (msg.includes('503') || msg.includes('502') || msg.includes('500')) {
      return true;
    }
    if (msg.includes('econnreset') || msg.includes('socket hang up')) {
      return true;
    }
  }
  // Anthropic / OpenAI SDK errors expose `status` on the error object.
  const status = (err as { status?: number } | null)?.status;
  if (status && status >= 500) return true;
  if (status === 429) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
