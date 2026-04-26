// =============================================================================
// Generic Bayesian rubric scoring.
//
// Extracted and generalised from a production health-score module that combined
// 8 weighted sub-scores with OpenSkill-style mu/sigma confidence updates. The
// generalised version drops every domain assumption (industry, units,
// downstream UI) and exposes a pluggable `Rubric` whose only requirement is
// that callers describe their dimensions and feed it dimension scores.
//
// Two pieces moved with the extraction:
//   1. The mu/sigma representation per dimension — uncertainty is first-class,
//      not an after-thought tacked on as a separate confidence field.
//   2. The maturity ladder (discovery -> expert), originally a goal-gradient
//      engagement signal. Here it gives downstream consumers a single label
//      to act on ("only auto-publish if maturity >= calibrated").
// =============================================================================

import type {
  AggregateScore,
  Dimension,
  DimensionScore,
  MaturityLevel,
} from './types.js';

/**
 * Composable rubric. Construct with a list of dimensions and any non-default
 * options; call `aggregate()` to fold a set of dimension scores into a single
 * `AggregateScore`.
 *
 * The class is intentionally tiny — the heavy lifting is in the math and in
 * the dimension definitions, both of which the caller controls.
 */
export class Rubric {
  readonly dimensions: Dimension[];

  /** Reference sigma used to normalise confidence into 0–1. */
  private readonly referenceSigma: number;

  /**
   * @param dimensions Pluggable rubric dimensions. Order is preserved in
   *   `aggregate().perDimension` for stable CSV output.
   * @param options.referenceSigma Sigma value treated as "fully uncertain"
   *   when normalising confidence. Default 3.0 — picked so a sigma of 0
   *   maps to confidence 1.0 and a sigma of 3 maps to ~0.0.
   */
  constructor(
    dimensions: Dimension[],
    options: { referenceSigma?: number } = {},
  ) {
    if (dimensions.length === 0) {
      throw new Error('Rubric requires at least one dimension');
    }
    this.dimensions = dimensions;
    this.referenceSigma = options.referenceSigma ?? 3.0;
  }

  /**
   * Look up a dimension definition by key. Returns `undefined` if the key is
   * not part of this rubric — useful when reconciling judge output that may
   * include extra dimensions.
   */
  getDimension(key: string): Dimension | undefined {
    return this.dimensions.find((d) => d.key === key);
  }

  /**
   * Aggregate dimension scores into a single confidence-weighted result.
   *
   * The math:
   *   - Weighted mean of `mu` values, weighted by dimension weight.
   *   - Propagated variance: `sum(w_i^2 * sigma_i^2) / sum(w_i)^2`.
   *     This is the standard formula for a linear combination of independent
   *     Gaussians, and degrades gracefully when sigmas are heterogeneous.
   *   - `confidence = clamp(1 - sigma / referenceSigma, 0, 1)` — a simple,
   *     monotonic mapping that keeps consumers from having to reason about
   *     the sigma scale directly.
   *
   * Missing dimensions are treated as zero-weight, not zero-mu — this avoids
   * silently dragging the aggregate down when the judge skipped a dimension.
   */
  aggregate(scores: DimensionScore[]): AggregateScore {
    const byKey = new Map(scores.map((s) => [s.dimension, s]));
    const present = this.dimensions
      .map((dim) => ({ dim, score: byKey.get(dim.key) }))
      .filter((x): x is { dim: Dimension; score: DimensionScore } =>
        x.score !== undefined,
      );

    if (present.length === 0) {
      return {
        mu: 0,
        sigma: this.referenceSigma,
        confidence: 0,
        perDimension: [],
      };
    }

    const weightSum = present.reduce((s, { dim }) => s + dim.weight, 0);
    const weightedMu =
      present.reduce((s, { dim, score }) => s + dim.weight * score.mu, 0) /
      weightSum;

    const propagatedVariance =
      present.reduce(
        (s, { dim, score }) =>
          s + Math.pow(dim.weight, 2) * Math.pow(score.sigma, 2),
        0,
      ) / Math.pow(weightSum, 2);
    const propagatedSigma = Math.sqrt(propagatedVariance);

    const confidence = clamp(1 - propagatedSigma / this.referenceSigma, 0, 1);

    return {
      mu: round(weightedMu, 3),
      sigma: round(propagatedSigma, 3),
      confidence: round(confidence, 3),
      perDimension: this.dimensions
        .map((dim) => byKey.get(dim.key))
        .filter((s): s is DimensionScore => s !== undefined),
    };
  }
}

/**
 * Map an aggregate score to a maturity band. Bands are defined on
 * `confidence` rather than `mu` — a high-mu score with wide error bars is
 * not yet calibrated, and that distinction is the whole point of the rubric.
 *
 * Thresholds are conservative on purpose: production deployments should
 * require `calibrated` or better before auto-actioning a model's output.
 */
export function classifyMaturity(score: AggregateScore): MaturityLevel {
  const c = score.confidence;
  if (c >= 0.9) return 'expert';
  if (c >= 0.75) return 'calibrated';
  if (c >= 0.55) return 'predictive';
  if (c >= 0.3) return 'operational';
  return 'discovery';
}

/**
 * Format an aggregate score for terminal/markdown reports.
 */
export function formatAggregate(score: AggregateScore): string {
  return `mu=${score.mu.toFixed(2)} sigma=${score.sigma.toFixed(
    2,
  )} confidence=${score.confidence.toFixed(2)} maturity=${classifyMaturity(
    score,
  )}`;
}

// ---------------------------------------------------------------------------
// Local helpers — kept private to avoid leaking utility names into consumers.
// ---------------------------------------------------------------------------

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function round(value: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}
