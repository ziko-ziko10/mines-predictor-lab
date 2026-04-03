export type RoundResult = "WON" | "LOST";

export interface CellInsight {
  cellIndex: number;
  label: string;
  riskScore: number;
  safetyScore: number;
  confidence: number;
  mineRate: number;
  playWinRate: number;
  predictionFailureRate: number;
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
  note: string;
  suggestedCells: number[];
  rankedCells: CellInsight[];
}

export interface RoundSubmission {
  mineCount: number;
  predictionCount: number;
  predictedCells: number[];
  result: RoundResult;
  playedCells?: number[];
  hitCell?: number | null;
  mineLocations?: number[];
}

export interface RoundLog {
  id: string;
  mineCount: number;
  predictionCount: number;
  predictedCells: number[];
  playedCells: number[];
  result: RoundResult;
  hitCell: number | null;
  mineLocations: number[];
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
  note: string;
  suggestedCells: number[];
  cells: CellInsight[];
  safestCells: CellInsight[];
  riskiestCells: CellInsight[];
  recentRounds: RoundLog[];
}
