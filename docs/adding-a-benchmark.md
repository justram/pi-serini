# Adding a benchmark

This repo is now benchmark-manifest-driven.
Adding a new benchmark should primarily mean registering one typed benchmark definition and implementing any benchmark-specific setup scripts, not editing a dozen unrelated entrypoints.

## Design intent

The architecture intentionally separates:

- generic orchestration concerns
  - setup dispatch
  - benchmark/query-set default resolution
  - run-manifest snapshots
  - summarize/eval/report entrypoints
  - managed preset lookup
- benchmark-specific concerns
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
- `src/benchmarks/template_benchmark.ts`

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

## 4. Decide evaluation semantics

The generic retrieval/report pipeline assumes path defaults can come from the benchmark manifest, but not every benchmark necessarily has the same semantics.

Decide explicitly:

- Is retrieval evaluation supported?
- Is there a secondary qrels view?
- Is judge evaluation supported?
- Does ground truth exist in a compatible format?
- Do report sections still make sense for this benchmark?

If the benchmark requires semantic differences instead of just different paths, add benchmark-specific evaluation adapters deliberately rather than smuggling differences through ad hoc conditionals.

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

Verify that downstream tools resolve your benchmark correctly from that snapshot:

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

- `src/benchmarks/registry.test.ts`
- `src/launcher_wrappers.test.ts`
- `src/report_run_markdown.test.ts`

## 9. Document the benchmark

Update operator-facing docs:

- `README.md`
- `docs/reproducibility.md`
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
6. Verify summarize/eval/report behavior
7. Add tests
8. Update docs

## What not to do

Do not:

- hardcode new benchmark defaults into many separate CLIs
- add fallback legacy dual-mode logic unless there is a real compatibility requirement
- hide benchmark-specific evaluation semantics inside generic path helpers
- make shell wrappers the only supported path for a new benchmark

The intended steady state is:

- benchmark metadata lives in typed registry entries
- Node-first entrypoints are the preferred operator surface
- shell is a compatibility or subprocess boundary, not the control plane
