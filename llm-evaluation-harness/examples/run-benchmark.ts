// =============================================================================
// Example: run the benchmark across all vignettes against all configured
// providers, write a CSV, and print a one-line summary per (model, vignette).
//
// Usage:
//   cp .env.example .env  (then fill in keys)
//   npx tsx examples/run-benchmark.ts
//
// At least one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY must be
// set. Missing providers are skipped with a warning.
// =============================================================================

import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadVignettesFromDir, runBenchmark } from '../src/harness.js';
import { availableModels } from '../src/models.js';
import { classifyMaturity } from '../src/rubric.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function main(): Promise<void> {
  const models = availableModels();
  if (models.length === 0) {
    console.error(
      'No API keys configured. Set at least one of ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY in .env',
    );
    process.exit(1);
  }
  console.log(`Available providers: ${models.join(', ')}`);

  const vignettes = await loadVignettesFromDir(
    path.join(repoRoot, 'vignettes'),
  );
  console.log(`Loaded ${vignettes.length} vignettes`);

  const result = await runBenchmark(vignettes, {
    models,
    outputPath: path.join(
      repoRoot,
      'reports',
      `${new Date().toISOString().slice(0, 10)}-benchmark.csv`,
    ),
    verbose: true,
  });

  console.log(`\nReport written to ${result.reportPath}`);
  console.log(`Total rows: ${result.rowCount}\n`);

  console.log('Aggregate scores:');
  console.log(
    'vignette                                  model    mu     sigma  maturity',
  );
  console.log('-'.repeat(80));
  for (const evalRecord of result.evaluations) {
    const id = evalRecord.vignetteId.padEnd(40);
    const model = evalRecord.model.padEnd(8);
    const mu = evalRecord.aggregate.mu.toFixed(2).padEnd(6);
    const sigma = evalRecord.aggregate.sigma.toFixed(2).padEnd(6);
    const maturity = classifyMaturity(evalRecord.aggregate);
    console.log(`${id}  ${model} ${mu} ${sigma} ${maturity}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
