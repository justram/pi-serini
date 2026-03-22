# Adding a benchmark

This repo is benchmark-manifest-driven.
Adding a new benchmark should primarily mean registering one typed benchmark definition and implementing any benchmark-specific setup scripts, not editing a dozen unrelated entrypoints.

Related docs:

- [running-benchmarks.md](./running-benchmarks.md) for the operator surface you should preserve
- [evaluation.md](./evaluation.md) for retrieval and judge semantics you must model explicitly
- [reproducibility.md](./reproducibility.md) for run-manifest snapshots, setup artifacts, and provenance expectations

## Design intent

The architecture intentionally separates:

- generic orchestration concerns under `src/orchestration/`
  - setup dispatch
  - benchmark/query-set default resolution
  - run-manifest snapshots
  - summarize/eval/report entrypoints
  - managed preset lookup
- compatibility-only preserved historical contracts under `src/legacy/`
  - low-level entrypoints retained for wrapper and workflow compatibility
- shared runtime primitives under `src/runtime/`
  - prompt construction
  - artifact-path helpers
  - isolated agent-dir handling
- benchmark-specific concerns under `src/benchmarks/` plus benchmark-scoped setup scripts
  - dataset/query files
  - qrels and optional secondary qrels
  - optional ground truth
  - setup scripts
  - optional managed presets

That separation is what keeps multi-benchmark support maintainable.

## 1. Add the benchmark definition

Create a new file under:

- `src/benchmarks/<your_benchmark>.ts`

Export a `BenchmarkDefinition`.
The current examples are:

- `src/benchmarks/browsecomp_plus.ts`
- `src/benchmarks/template_benchmark.ts` for a tiny self-contained local benchmark that builds its own demo index

A benchmark definition must specify:

- `id`
- `aliases`
- `displayName`
- `datasetId`
- `promptVariant`
- `defaultQuerySetId`
- `defaultQueryPath`
- `querySets`
- `defaultQrelsPath`
- `defaultSecondaryQrelsPath` if applicable
- `defaultGroundTruthPath` if applicable
- `defaultIndexPath`
- `managedPresets`
- `setup.steps`

Important rule:
keep defaults benchmark-scoped and declarative here instead of spreading them across CLI entrypoints.

`querySets` can be either:

- a simple string query path
- or an object with query-set-specific overrides such as `queryPath`, `qrelsPath`, `secondaryQrelsPath`, `groundTruthPath`, and `indexPath`

Use query-set-specific overrides when different query sets need different qrels, as with MSMARCO `dl19` vs `dl20`.

## 2. Register the benchmark

Update:

- `src/benchmarks/registry.ts`

Import the new benchmark and add it to `BENCHMARKS`.

Once registered, these generic helpers will automatically understand it:

- `getBenchmarkDefinition()`
- `resolveBenchmarkConfig()`
- `createBenchmarkManifestSnapshot()`
- `resolveManagedPreset()`
- `resolveBenchmarkSetupStep()`

## 3. Add benchmark-scoped setup scripts

Add benchmark-specific setup implementations under:

- `scripts/benchmarks/<your_benchmark>/setup.sh`
- `scripts/benchmarks/<your_benchmark>/setup_ground_truth.sh` if needed
- `scripts/benchmarks/<your_benchmark>/generate_query_slices.sh` if needed

Then point `setup.steps` at those scripts from the benchmark definition.

Why this boundary exists:
setup internals are often dataset-specific, but setup dispatch should still be standardized.

The current architectural decision is to keep benchmark setup implementations as benchmark-scoped subprocess boundaries unless a benchmark's setup becomes simple enough to be genuinely generic. In other words, `src/orchestration/setup_benchmark_entry.ts` owns the operator-facing control plane, while `scripts/benchmarks/<your_benchmark>/...` owns the benchmark-specific bootstrap details.

## 4. Decide evaluation semantics

The generic retrieval/report pipeline assumes path defaults can come from the benchmark manifest, but not every benchmark necessarily has the same semantics.

Decide explicitly:

- Is retrieval evaluation supported?
- Is there a secondary qrels view?
- Is judge evaluation supported?
- Does ground truth exist in a compatible format?
- Do report sections still make sense for this benchmark?

A valid answer is "retrieval-only for now". If a benchmark does not naturally provide answer-style ground truth, you now have two explicit judge options:

- `gold-answer` mode: set `defaultGroundTruthPath` and treat reported accuracy as externally anchored gold-answer accuracy
- `reference-free` mode: leave `defaultGroundTruthPath` unset, declare reference-free judge support in the benchmark manifest, and make sure reports label the top-line metric as `Accuracy (reference-free judge)` rather than implying gold-answer supervision

Do not invent fake ground-truth compatibility just to reuse the gold-answer path.

If the benchmark requires semantic differences instead of just different paths, add benchmark-specific evaluation adapters deliberately rather than smuggling differences through ad hoc conditionals. The current mechanism is `BenchmarkDefinition.retrievalEvaluation`, which lets a benchmark choose an internal TypeScript backend or a `trec_eval` run-file backend. Both backends now write normalized retrieval-summary artifacts under `evals/retrieval/<benchmark>/...`.

## 5. Decide managed presets

If the benchmark needs operator-facing managed presets for `benchctl`, define them in:

- `managedPresets`

Each preset can define:

- launcher script
- output-dir template
- log-dir template
- launcher env
- default shard count

Use registry-defined presets for benchmark-specific ergonomics, but keep generic launch entrypoints benchmark-agnostic.

## 6. Add or stage local assets

Typical local asset layout should remain benchmark-scoped:

- `data/<dataset>/queries/...`
- `data/<dataset>/qrels/...`
- `data/<dataset>/ground-truth/...`
- `indexes/<index-name>/`

Avoid reusing BrowseComp-Plus paths or names in a new benchmark unless the assets are genuinely shared.

## 7. Verify run-manifest behavior

Every run should emit:

- `<run>/benchmark_manifest_snapshot.json`

New direct runs should also emit:

- `<run>/run_setup.json`

Verify that downstream tools resolve your benchmark correctly from those artifacts:

- summarize
- retrieval eval
- judge eval if supported
- Markdown report
- monitor autodetection

This is critical because reproducibility now depends on artifact-local benchmark metadata, not only mutable repo defaults.

## 8. Add tests

At minimum, add or update tests for:

- registry lookup
- query-set resolution
- setup-step resolution
- managed preset lookup if applicable
- launcher dry-run/default resolution
- report/eval/summarize manifest precedence if your benchmark changes those paths

Good starting files:

- `tests/benchmarks/registry.test.ts`
- `tests/launcher_wrappers.test.ts`
- `tests/report_run_markdown.test.ts`

## 9. Document the benchmark

Update operator-facing docs:

- `README.md`
- `docs/running-benchmarks.md`
- `docs/evaluation.md` if the benchmark changes semantics
- `docs/reproducibility.md` if the benchmark changes setup or provenance expectations
- this file if the benchmark introduces new conventions worth standardizing

Document:

- benchmark id
- supported query sets
- setup path
- expected local assets
- whether judge evaluation is supported
- any managed presets

## Practical checklist

Use this as the short version:

1. Add `src/benchmarks/<your_benchmark>.ts`
2. Register it in `src/benchmarks/registry.ts`
3. Add `scripts/benchmarks/<your_benchmark>/...` setup scripts
4. Add local dataset/index path conventions under `data/` and `indexes/`
5. Verify run-manifest snapshot output
6. Verify `run_setup.json` output for new runs
7. Verify summarize/eval/report behavior
8. Add tests
9. Update docs

## What not to do

Do not:

- hardcode new benchmark defaults into many separate CLIs
- add fallback legacy dual-mode logic unless there is a real compatibility requirement
- hide benchmark-specific evaluation semantics inside generic path helpers
- make shell wrappers the only supported path for a new benchmark

The intended steady state is:

- benchmark metadata lives in typed registry entries
- active Node-first entrypoints live under `src/orchestration/`
- compatibility-only TypeScript entrypoints live under `src/legacy/`
- shared runtime helpers live under `src/runtime/`
- benchmark setup scripts remain benchmark-scoped subprocess implementations unless they become genuinely generic enough to migrate cleanly
- the BM25 JVM helper remains callable through `scripts/bm25_server.sh`, but BM25 launch semantics are owned in typed TypeScript under `src/bm25/`
- shell is a compatibility or subprocess boundary, not the control plane
