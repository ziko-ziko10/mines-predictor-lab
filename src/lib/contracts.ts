export type RoundResult = "WON" | "LOST";
export type PredictionMode = "CONFIDENT" | "EXPLORATORY" | "ABSTAIN";

export type EvaluationStatus = "INSUFFICIENT_COVERAGE" | "PROVISIONAL" | "WEAK_SIGNAL" | "SUPPORTED";

export interface MetricDelta {
  value: number;
  lower: number;
  upper: number;
}

export interface BenchmarkMetrics {
  label: string;
  averageSafeRate: number;
  averageSafeRateLower: number;
  averageSafeRateUpper: number;
  fullSurvivalRate: number;
  fullSurvivalRateLower: number;
  fullSurvivalRateUpper: number;
  averageMineHits: number;
  brierScore: number | null;
  precisionAtK: number;
  precisionAtKLower: number;
  precisionAtKUpper: number;
  precisionK: number;
  topCellSafeRate: number;
  topCellSafeRateLower: number;
  topCellSafeRateUpper: number;
}

export interface HoldoutEvaluation {
  truthKnownRounds: number;
  truthCoverage: number;
  holdoutRounds: number;
  trainingRounds: number;
  reliable: boolean;
  status: EvaluationStatus;
  minimumKnownRounds: number;
  minimumTrainingRounds: number;
  minimumTruthRounds: number;
  note: string;
  provisionalReasons: string[];
  currentModel: BenchmarkMetrics;
  frequencyBaseline: BenchmarkMetrics;
  randomBaseline: BenchmarkMetrics;
  safeRateLiftVsRandom: MetricDelta;
  safeRateLiftVsFrequency: MetricDelta;
  fullSurvivalLiftVsRandom: MetricDelta;
  fullSurvivalLiftVsFrequency: MetricDelta;
}

export interface CellInsight {
  cellIndex: number;
  label: string;
  riskScore: number;
  safetyScore: number;
  confidence: number;
  mineRate: number;
  playWinRate: number;
  predictionFailureRate: number;
  mineRateLowerBound: number;
  mineRateUpperBound: number;
  timesPredicted: number;
  timesPlayed: number;
  mineReports: number;
  estimatedMineProbability: number;
  estimatedSafeProbability: number;
  uncertaintyWidth: number;
  supportScore: number;
  truthSupport: number;
  playedSupport: number;
  playedSafeRate: number;
  playedMineRate: number;
  truthOnlyMineProbability: number;
  truthOnlySafeProbability: number;
  recentMineProbability: number;
  recentSafeProbability: number;
  recentTruthMineProbability: number;
  recentPlayedMineProbability: number;
  driftScore: number;
  heuristicRiskScore: number;
  supportedMostlyByTruth: boolean;
  supportTier: "WEAK" | "PLAYED" | "MIXED" | "TRUTH";
}

export interface PredictionResponse {
  mineCount: number;
  predictionCount: number;
  totalRounds: number;
  totalWins: number;
  totalLosses: number;
  predictionMode: PredictionMode;
  abstainReason: string | null;
  signalScore: number;
  minimumRoundsForSignal: number;
  truthKnownRounds: number;
  truthCoverage: number;
  modelVersion: string;
  deterministic: boolean;
  averageTopSafeProbability: number;
  averageTopUncertainty: number;
  decisionReasons: string[];
  evaluationStatus: EvaluationStatus;
  note: string;
  suggestedCells: number[];
  rankedCells: CellInsight[];
}

export interface RoundSubmission {
  mineCount: number;
  predictionCount: number;
  predictedCells: number[];
  predictionMode?: PredictionMode;
  result: RoundResult;
  playedCells?: number[];
  hitCell?: number | null;
  mineLocations?: number[];
  serverSeed?: string;
  clientSeed?: string;
  nonce?: string;
}

export interface RoundLog {
  id: string;
  userId: string;
  mineCount: number;
  predictionCount: number;
  predictionMode: PredictionMode;
  predictedCells: number[];
  playedCells: number[];
  result: RoundResult;
  hitCell: number | null;
  mineLocations: number[];
  serverSeed: string | null;
  clientSeed: string | null;
  nonce: string | null;
  createdAt: string;
}

export interface MineCountSummary {
  mineCount: number;
  totalRounds: number;
  wins: number;
  losses: number;
  winRate: number;
  lastPlayedAt: string | null;
}

export interface AnalyticsSnapshot {
  mineCount: number;
  totalRounds: number;
  wins: number;
  losses: number;
  averagePredictionCount: number;
  predictionMode: PredictionMode;
  abstainReason: string | null;
  signalScore: number;
  minimumRoundsForSignal: number;
  truthKnownRounds: number;
  truthCoverage: number;
  modelVersion: string;
  deterministic: boolean;
  averageTopSafeProbability: number;
  averageTopUncertainty: number;
  decisionReasons: string[];
  evaluationStatus: EvaluationStatus;
  note: string;
  suggestedCells: number[];
  cells: CellInsight[];
  safestCells: CellInsight[];
  riskiestCells: CellInsight[];
  recentRounds: RoundLog[];
  evaluation: HoldoutEvaluation;
}
