import type { BenchmarkPromptVariant } from "../prompt";

export type BenchmarkManagedPresetDefinition = {
  id: string;
  querySetId: string;
  launcherScript: string;
  outputDirTemplate: string;
  logDirTemplate: string;
  launcherEnv?: Record<string, string>;
  defaultShardCount?: number;
};

export type BenchmarkSetupStep = "setup" | "ground-truth" | "query-slices";

export type BenchmarkSetupDefinition = {
  steps: Partial<Record<BenchmarkSetupStep, string>>;
};

export type BenchmarkDefinition = {
  id: string;
  aliases: string[];
  displayName: string;
  datasetId: string;
  promptVariant: BenchmarkPromptVariant;
  defaultQuerySetId: string;
  defaultQueryPath: string;
  querySets: Record<string, string>;
  defaultQrelsPath: string;
  defaultSecondaryQrelsPath?: string;
  defaultGroundTruthPath?: string;
  defaultIndexPath: string;
  defaultCompareQuerySetId?: string;
  defaultBaselineRunPath?: string;
  managedPresets: Record<string, BenchmarkManagedPresetDefinition>;
  setup: BenchmarkSetupDefinition;
};

export type ResolvedBenchmarkConfig = {
  benchmark: BenchmarkDefinition;
  querySetId: string;
  queryPath: string;
  qrelsPath: string;
  secondaryQrelsPath?: string;
  groundTruthPath?: string;
  indexPath: string;
};

export type BenchmarkManifestSnapshot = {
  benchmark_id: string;
  benchmark_display_name: string;
  dataset_id: string;
  query_set_id: string;
  prompt_variant: BenchmarkPromptVariant;
  query_path: string;
  qrels_path: string;
  secondary_qrels_path?: string;
  ground_truth_path?: string;
  index_path: string;
};
