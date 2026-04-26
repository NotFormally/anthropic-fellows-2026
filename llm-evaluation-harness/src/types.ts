// =============================================================================
// Shared types for the evaluation harness.
//
// Kept in a single file so consumers can import the full vocabulary from one
// path. Domain-specific types (psychiatric vignettes, rubric dimensions) live
// here too — the design intent is "one repo, one mental model".
// =============================================================================

/**
 * Identifier for a supported provider/model. New providers go here first.
 */
export type ModelId = 'claude' | 'gpt' | 'gemini';

/**
 * Maturity bands describing how confident an aggregate score is.
 *
 * The thresholds are defined in `rubric.ts::classifyMaturity`. The semantics
 * mirror a calibration ladder: a model that the rubric has only seen a few
 * times sits in `discovery`; a model with consistent, low-variance evaluations
 * across many vignettes can climb toward `expert`.
 */
export type MaturityLevel =
  | 'discovery'
  | 'operational'
  | 'predictive'
  | 'calibrated'
  | 'expert';

/**
 * A single dimension of the rubric. Dimensions are pluggable: callers compose
 * a `Rubric` by passing the list of dimensions they care about.
 */
export type Dimension = {
  /** Stable machine identifier — used as a column key in CSV reports. */
  key: string;
  /** Human-readable label, suitable for UI or markdown. */
  label: string;
  /** Weight in the aggregate (does not need to sum to 1; we normalize). */
  weight: number;
  /** Plain-language description of what this dimension measures. */
  description: string;
  /**
   * Anchor descriptions for rubric bands. Each anchor binds a numeric range
   * (lo–hi inclusive) to specific observable criteria. Used in the judge
   * prompt to ground the score in concrete behaviour.
   */
  anchors: RubricAnchor[];
};

/**
 * Bayesian-flavoured score for a single dimension.
 *
 * `mu` is the point estimate on the dimension's natural scale (typically 0–10).
 * `sigma` captures the judge's uncertainty about that estimate. Higher sigma
 * means the judge could not commit to a tight interval — usually because the
 * vignette was ambiguous, the response was off-topic, or the rubric criteria
 * did not cleanly apply.
 */
export type DimensionScore = {
  dimension: string;
  mu: number;
  sigma: number;
  notes?: string;
};

/**
 * Aggregate of all dimension scores for a single response.
 *
 * `mu` is the weighted mean across dimensions; `sigma` is the propagated
 * uncertainty (square root of the weighted sum of variances). `confidence`
 * is a derived 0–1 normalization of `sigma`, useful for UI gauges and for
 * gating downstream actions ("only ship if confidence > 0.7").
 */
export type AggregateScore = {
  mu: number;
  sigma: number;
  confidence: number;
  perDimension: DimensionScore[];
};

/**
 * Anchor for a rubric band. The judge prompt enumerates these so the model
 * can map observed behaviour to a numeric range with explicit rationale.
 */
export type RubricAnchor = {
  range: [number, number];
  label: string;
  criteria: string;
};

/**
 * Frontmatter of a clinical vignette. The body of the vignette lives in the
 * markdown after the frontmatter and is sent verbatim to each candidate model.
 */
export type VignetteFrontmatter = {
  id: string;
  scenario_type: string;
  /** Optional Zendo principle this vignette is anchored on. */
  zendo_principle?: string;
  severity: 'low' | 'moderate' | 'high' | 'critical';
  expected_behavior: string;
};

/**
 * Fully parsed vignette: frontmatter plus the prose body that becomes the
 * user message sent to candidate models.
 */
export type Vignette = {
  frontmatter: VignetteFrontmatter;
  body: string;
  /** Absolute or relative path the vignette was loaded from. */
  sourcePath: string;
};

/**
 * One row of the CSV report — captures the full provenance of a single
 * (vignette, model, dimension) datapoint.
 */
export type ReportRow = {
  vignette_id: string;
  scenario_type: string;
  severity: string;
  model: ModelId;
  dimension: string;
  mu: number;
  sigma: number;
  notes: string;
};

/**
 * Wraps a model response with metadata needed for downstream scoring and
 * reporting. The harness keeps this around even after scoring so that
 * post-hoc audits can inspect the raw text the model produced.
 */
export type ModelResponse = {
  model: ModelId;
  vignetteId: string;
  text: string;
  latencyMs: number;
  /** Set when the call failed but the harness chose to continue. */
  error?: string;
};

/**
 * The full result of evaluating one vignette against one model: the response
 * text plus the dimension-by-dimension scores from the judge.
 */
export type EvaluationRecord = {
  response: ModelResponse;
  aggregate: AggregateScore;
};
