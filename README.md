# Nassim Saighi — Anthropic Fellows 2026 Application Portfolio

MD (Université Laval, research-track), former psychiatry resident with 4 years of advanced postgraduate training at Université de Montréal, transitioning into empirical AI safety research with a focus on **frontier-model safety in high-stakes mental-health deployments**.

This repository accompanies my application to the [Anthropic Fellows Program 2026](https://www.anthropic.com/fellows-program). It is organized in two tiers — primary work directly tied to the research proposal, and portfolio pieces demonstrating ambient capability in agentic Claude development.

---

## 🎯 Primary work — research proposal companion

### [`llm-evaluation-harness/`](./llm-evaluation-harness)

Clinician-led evaluation framework for LLM peer-support in psychedelic altered states. **Direct companion to the research proposal submitted with this application.**

→ **Research Proposal (full PDF, view-only)** : [Adaptive Harm-Reduction Framework for LLMs Serving Users in Psychedelic Altered States](https://drive.google.com/file/d/1L77H5l47QwVJ6wG8lLYdtN2bWlK53xKA/view?usp=drive_link)

**5 vignettes** spanning the dual-use generalization from psychedelic to non-substance prodromal contexts:

| # | ID | Lang | Turns | Primary principle |
|---|---|---|---|---|
| 01 | `lithium-interaction-prevention` | EN | 1 | informed_autonomy_emergent |
| 02 | `ego-fragmentation-acute-crisis` | FR + EN ref | 4 | create_safe_space_emergent |
| 03 | `pre-delusional-reframing` | EN | 3 | discriminative_framing_emergent |
| 04 | `existential-metaphysical-engagement` | FR + EN ref | 3 | epistemic_humility_emergent |
| 05 | `post-acute-insight-integration` | ES + EN ref | 3 | scope_clarity_emergent |

**Multi-dimensional rubric** (per-vignette dimensions weighted to scenario), with **theoretical grounding** drawing on:

- The Zendo Project's four principles (MAPS, *Manual of Psychedelic Support*, 2017) and four silent corollaries surfaced during the LLM-translation exercise (sitting-not-curating, sitting-not-explaining, restraint-as-care, engaging-porosity-without-naming-it)
- Cognitive Behavioral Therapy for Psychosis (CBTp): Kingdon & Turkington 2005, Garety/Bebbington/Fowler 2001, Morrison 2004
- Clinical High Risk for Psychosis (CHR-P): Yung & McGorry 1996, Fusar-Poli consensus, Birchwood critical-period framework
- Inner-directed therapy (Mithoefer/Phelps psychedelic integration training)
- Spiritual bypass and metaphysical inflation (Welwood 1984, Yaden et al.)
- DSM clinical-neutrality stance on spiritual content (Lukoff, Lu & Turner 1992)
- Sycophancy in language models (Sharma et al., Anthropic 2023)
- Epistemic colonization and parasocial AI dependence (Birhane 2021)
- Empirical psychedelic-cognition base (Wießner et al. 2023, Family et al. 2016, Kraehenmann et al. 2017)
- Evidence-based suicide screening (C-SSRS) and Canadian crisis-resource pathways (9-8-8 / 811 / 911)

The seed corpus illustrates a **methodological contribution**: clinician-led co-design of vignette content and rubric criteria as a tractable mechanism for translating mature peer-support frameworks into operationalizable LLM behavior specifications, with each principle refinement traceable to a specific case where the unrefined version failed to discriminate.

→ Each vignette is fully scripted (user turns + exemplar responses) with anti-patterns and theoretical-grounding sections. See [`llm-evaluation-harness/vignettes/`](./llm-evaluation-harness/vignettes).

---

## Portfolio — ambient capability demonstrations

These two repositories demonstrate engineering capability in agentic Claude development. They are **not** part of the research proposal; they exist as evidence of applied-LLM discipline.

### [`portfolio/claude-agent-harness-demo/`](./portfolio/claude-agent-harness-demo)

Production-extracted TypeScript patterns from a multi-tenant Next.js/Supabase SaaS:

- `orchestrator.ts` — verifier/repair loop with typed contracts
- `cost-tracker.ts` — multi-tenant AI usage logging with daily cost caps
- `invoice-vision-extractor.ts` — multimodal (image + PDF) extraction with per-row self-confidence scoring and defense-in-depth safety
- `prompt-guard.ts` — multi-layer prompt-injection defense (170+ bilingual EN/FR rules, canary tokens, Unicode/structural detection)

### [`portfolio/claude-code-harness-patterns/`](./portfolio/claude-code-harness-patterns)

Architectural documentation for multi-agent Claude Code workflows:

- `orchestrator-patterns.md` — five named delegation topologies (Solver+Verifier, Parallel Solvers, Multi-Candidate Search, Pipeline, Audit Fleet) with fork-context and worktree decision trees
- `runtime-charter.md` — ten-section runtime policy: parent-as-orchestrator, minimal delegated baseline, contract-first completion, child lifecycle, worktree isolation rules
- `failure-taxonomy.md` — sixteen named failure modes grouped by stage / verification / orchestration / environment, each with a specific recovery action
- `contract-template.md` — explicit YAML contract format for any non-trivial agent (inputs, outputs, gates, budget, failure policy, stop conditions) plus the standard `PLAN → EXECUTE → VERIFY → REPAIR → RESPOND` stage structure

The implementation backing these documents is a personal 17-agent Claude Code fleet (private).

---

## About

- **MD**, Université Laval (research-track, 2021)
- **Former psychiatry resident** — 4 years of advanced postgraduate training, Université de Montréal
- **Recent**: paid clinical-AI audit contract evaluating frontier-model responses in suicide-risk triage (Vetted Medical, Feb–Apr 2026)
- **Active research**: lead investigator on a PRISMA-ScR scoping review on psychedelic use in personality disorders (manuscript in finalization, April 2026); co-investigator on a Phase 2 psilocybin trial at IUSMM (PAP-BPD)
- **Publications**: 225+ combined citations across peer-reviewed journals (EJNMMI 2019, EJNMMI Physics 2018)

No formal computer-science training. All applied LLM work is self-built through production projects with Claude Code as force multiplier.

→ [LinkedIn](https://www.linkedin.com/in/nassim-saighi-b31440195/)

---

## License

MIT (see `LICENSE` files in each subfolder).
