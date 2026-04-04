export type RoundResult = "WON" | "LOST";
export type PredictionMode = "CONFIDENT" | "EXPLORATORY" | "ABSTAIN";

export interface BenchmarkMetrics {
  label: string;
  averageSafeRate: number;
  averageSafeRateLower: number;
  averageSafeRateUpper: number;
  fullSurvivalRate: number;
  fullSurvivalRateLower: number;
  fullSurvivalRateUpper: number;
  averageMineHits: number;
}

export interface HoldoutEvaluation {
  truthKnownRounds: number;
  truthCoverage: number;
  holdoutRounds: number;
  trainingRounds: number;
  reliable: boolean;
  minimumKnownRounds: number;
  note: string;
  currentModel: BenchmarkMetrics;
  frequencyBaseline: BenchmarkMetrics;
  randomBaseline: BenchmarkMetrics;
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
  note: string;
  suggestedCells: number[];
  cells: CellInsight[];
  safestCells: CellInsight[];
  riskiestCells: CellInsight[];
  recentRounds: RoundLog[];
  evaluation: HoldoutEvaluation;
}
