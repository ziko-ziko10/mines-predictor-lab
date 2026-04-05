import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { normalizeCells, parseCells, serializeCells } from "@/lib/board";
import type {
  AnalyticsSnapshot,
  MineCountSummary,
  PredictionMode,
  PredictionResponse,
  RoundLog,
  RoundResult,
  RoundSubmission,
} from "@/lib/contracts";
import { buildHoldoutEvaluation } from "@/lib/evaluation";
import {
  MODEL_VERSION,
  buildCellInsights,
  buildPredictionDecision,
  buildPredictorNote,
  countTruthKnownRounds,
  pickSuggestedCells,
} from "@/lib/predictor";
import { deriveStatsFromHistoryRounds, normalizeHistoryRound, type ModelHistoryRound, type RawCellStat } from "@/lib/round-stats";
import { roundSubmissionSchema } from "@/lib/validators";

type RoundRow = {
  id: string;
  userId: string;
  mineCount: number;
  predictionCount: number;
  predictionMode: PredictionMode;
  predictedCells: string;
  playedCells: string | null;
  result: RoundResult;
  hitCell: number | null;
  mineLocations: string | null;
  serverSeed: string | null;
  clientSeed: string | null;
  nonce: string | null;
  createdAt: Date;
};

function toRoundLog(round: RoundRow): RoundLog {
  return {
    id: round.id,
    userId: round.userId,
    mineCount: round.mineCount,
    predictionCount: round.predictionCount,
    predictionMode: round.predictionMode,
    predictedCells: parseCells(round.predictedCells),
    playedCells: parseCells(round.playedCells),
    result: round.result,
    hitCell: round.hitCell,
    mineLocations: parseCells(round.mineLocations),
    serverSeed: round.serverSeed,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    createdAt: round.createdAt.toISOString(),
  };
}

function toModelHistoryRound(round: Pick<RoundRow, "predictionCount" | "predictedCells" | "playedCells" | "result" | "hitCell" | "mineLocations">) {
  return normalizeHistoryRound({
    predictionCount: round.predictionCount,
    predictedCells: parseCells(round.predictedCells),
    playedCells: parseCells(round.playedCells),
    result: round.result,
    hitCell: round.hitCell,
    mineLocations: parseCells(round.mineLocations),
  });
}

function sameStats(left: RawCellStat[], right: RawCellStat[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftEntry = left[index];
    const rightEntry = right[index];

    if (
      !rightEntry ||
      leftEntry.cellIndex !== rightEntry.cellIndex ||
      leftEntry.timesPredicted !== rightEntry.timesPredicted ||
      leftEntry.timesPlayed !== rightEntry.timesPlayed ||
      leftEntry.mineReports !== rightEntry.mineReports ||
      leftEntry.winCount !== rightEntry.winCount ||
      leftEntry.lossCount !== rightEntry.lossCount
    ) {
      return false;
    }
  }

  return true;
}

async function syncCellStatCache(
  client: Prisma.TransactionClient | typeof prisma,
  userId: string,
  mineCount: number,
  rounds: ModelHistoryRound[],
) {
  const derivedStats = deriveStatsFromHistoryRounds(rounds, mineCount);
  const cachedStats = await client.cellStat.findMany({
    where: { userId, mineCount },
    orderBy: { cellIndex: "asc" },
  });

  if (sameStats(cachedStats, derivedStats)) {
    return derivedStats;
  }

  await client.cellStat.deleteMany({
    where: { userId, mineCount },
  });

  if (derivedStats.length > 0) {
    await client.cellStat.createMany({
      data: derivedStats.map((stat) => ({
        userId,
        mineCount,
        cellIndex: stat.cellIndex,
        timesPredicted: stat.timesPredicted,
        timesPlayed: stat.timesPlayed,
        mineReports: stat.mineReports,
        winCount: stat.winCount,
        lossCount: stat.lossCount,
      })),
    });
  }

  return derivedStats;
}

function buildPredictionNote(
  totalRounds: number,
  totalLosses: number,
  predictionMode: PredictionMode,
  reasons: string[],
  evaluationNote: string,
) {
  const modeNote =
    predictionMode === "CONFIDENT"
      ? "The live set is deterministic and currently clears the walk-forward confidence gate."
      : predictionMode === "ABSTAIN"
        ? "The model is abstaining from a trust claim; any cells shown below should be treated as exploratory only."
        : "The model is still in exploratory mode because the evidence is not strong enough for a confident claim.";

  return [buildPredictorNote(totalRounds, totalLosses), modeNote, reasons[0], evaluationNote].filter(Boolean).join(" ");
}

function buildPredictionArtifacts(mineCount: number, predictionCount: number, roundRows: RoundRow[]) {
  const modelRounds = roundRows.map(toModelHistoryRound);
  const totalRounds = modelRounds.length;
  const totalWins = modelRounds.filter((round) => round.result === "WON").length;
  const totalLosses = totalRounds - totalWins;
  const truthKnownRounds = countTruthKnownRounds(modelRounds, mineCount);
  const rankedCells = buildCellInsights({
    mineCount,
    rounds: modelRounds,
  });
  const evaluation = buildHoldoutEvaluation(
    mineCount,
    roundRows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      ...toModelHistoryRound(row),
    })),
  );
  const decision = buildPredictionDecision({
    mineCount,
    insights: rankedCells,
    predictionCount,
    totalRounds,
    truthKnownRounds,
    evaluation,
  });
  const recentPredictions = modelRounds.slice(Math.max(0, modelRounds.length - 8)).reverse().map((round) => round.predictedCells);
  const suggestedCells = pickSuggestedCells(rankedCells, predictionCount, recentPredictions, decision.predictionMode);
  const note = buildPredictionNote(totalRounds, totalLosses, decision.predictionMode, decision.reasons, evaluation.note);

  return {
    modelRounds,
    totalRounds,
    totalWins,
    totalLosses,
    truthKnownRounds,
    rankedCells,
    evaluation,
    decision,
    suggestedCells,
    note,
  };
}

export async function getMineCountSummaries(userId: string): Promise<MineCountSummary[]> {
  const rounds = await prisma.round.findMany({
    where: {
      userId,
    },
    select: {
      mineCount: true,
      result: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const summaryMap = new Map<number, MineCountSummary>();

  for (const round of rounds) {
    const existing = summaryMap.get(round.mineCount) ?? {
      mineCount: round.mineCount,
      totalRounds: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      lastPlayedAt: null,
    };

    existing.totalRounds += 1;
    existing.wins += round.result === "WON" ? 1 : 0;
    existing.losses += round.result === "LOST" ? 1 : 0;
    existing.lastPlayedAt = existing.lastPlayedAt ?? round.createdAt.toISOString();
    summaryMap.set(round.mineCount, existing);
  }

  return Array.from(summaryMap.values())
    .map((summary) => ({
      ...summary,
      winRate: summary.totalRounds === 0 ? 0 : summary.wins / summary.totalRounds,
    }))
    .sort((left, right) => left.mineCount - right.mineCount);
}

export async function getGlobalMineCountSummaries(): Promise<MineCountSummary[]> {
  const rounds = await prisma.round.findMany({
    select: {
      mineCount: true,
      result: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const summaryMap = new Map<number, MineCountSummary>();

  for (const round of rounds) {
    const existing = summaryMap.get(round.mineCount) ?? {
      mineCount: round.mineCount,
      totalRounds: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      lastPlayedAt: null,
    };

    existing.totalRounds += 1;
    existing.wins += round.result === "WON" ? 1 : 0;
    existing.losses += round.result === "LOST" ? 1 : 0;
    existing.lastPlayedAt = existing.lastPlayedAt ?? round.createdAt.toISOString();
    summaryMap.set(round.mineCount, existing);
  }

  return Array.from(summaryMap.values())
    .map((summary) => ({
      ...summary,
      winRate: summary.totalRounds === 0 ? 0 : summary.wins / summary.totalRounds,
    }))
    .sort((left, right) => left.mineCount - right.mineCount);
}

export async function getPrediction(userId: string, mineCount: number, predictionCount: number): Promise<PredictionResponse> {
  return prisma.$transaction(async (transaction) => {
    const roundRows = (await transaction.round.findMany({
      where: { userId, mineCount },
      orderBy: { createdAt: "asc" },
    })) as RoundRow[];
    const modelRounds = roundRows.map(toModelHistoryRound);

    await syncCellStatCache(transaction, userId, mineCount, modelRounds);

    const artifacts = buildPredictionArtifacts(mineCount, predictionCount, roundRows);

    return {
      mineCount,
      predictionCount,
      totalRounds: artifacts.totalRounds,
      totalWins: artifacts.totalWins,
      totalLosses: artifacts.totalLosses,
      predictionMode: artifacts.decision.predictionMode,
      abstainReason: artifacts.decision.abstainReason,
      signalScore: artifacts.decision.signalScore,
      minimumRoundsForSignal: artifacts.decision.minimumRoundsForSignal,
      truthKnownRounds: artifacts.truthKnownRounds,
      truthCoverage: artifacts.totalRounds === 0 ? 0 : artifacts.truthKnownRounds / artifacts.totalRounds,
      modelVersion: MODEL_VERSION,
      deterministic: artifacts.decision.deterministic,
      averageTopSafeProbability: artifacts.decision.averageTopSafeProbability,
      averageTopUncertainty: artifacts.decision.averageTopCellUncertainty,
      decisionReasons: artifacts.decision.reasons,
      evaluationStatus: artifacts.evaluation.status,
      note: artifacts.note,
      suggestedCells: artifacts.suggestedCells,
      rankedCells: artifacts.rankedCells,
    };
  });
}

export async function logRound(userId: string, input: RoundSubmission) {
  const parsed = roundSubmissionSchema.parse({
    ...input,
    predictedCells: normalizeCells(input.predictedCells),
    playedCells: normalizeCells(input.playedCells ?? []),
    mineLocations: normalizeCells(input.mineLocations ?? []),
    hitCell: input.hitCell ?? null,
  }) as {
    mineCount: number;
    predictionCount: number;
    predictedCells: number[];
    predictionMode: PredictionMode;
    result: RoundResult;
    playedCells: number[];
    hitCell: number | null;
    mineLocations: number[];
    serverSeed: string;
    clientSeed: string;
    nonce: string;
  };

  return prisma.$transaction(async (transaction) => {
    const round = await transaction.round.create({
      data: {
        userId,
        mineCount: parsed.mineCount,
        predictionCount: parsed.predictionCount,
        predictionMode: parsed.predictionMode,
        predictedCells: serializeCells(parsed.predictedCells),
        playedCells: parsed.playedCells.length > 0 ? serializeCells(parsed.playedCells) : null,
        result: parsed.result,
        hitCell: parsed.hitCell ?? null,
        mineLocations: parsed.mineLocations.length > 0 ? serializeCells(parsed.mineLocations) : null,
        serverSeed: parsed.serverSeed || null,
        clientSeed: parsed.clientSeed || null,
        nonce: parsed.nonce || null,
      },
    });
    const roundRows = (await transaction.round.findMany({
      where: { userId, mineCount: parsed.mineCount },
      orderBy: { createdAt: "asc" },
    })) as RoundRow[];

    await syncCellStatCache(transaction, userId, parsed.mineCount, roundRows.map(toModelHistoryRound));

    return {
      id: round.id,
    };
  });
}

export async function getRecentRounds(userId: string, mineCount?: number, limit = 30): Promise<RoundLog[]> {
  const where: Prisma.RoundWhereInput = {
    userId,
    ...(mineCount ? { mineCount } : {}),
  };
  const rounds = (await prisma.round.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
  })) as RoundRow[];

  return rounds.map(toRoundLog);
}

export async function getAdminRecentRounds(mineCount?: number, limit = 50): Promise<RoundLog[]> {
  const where: Prisma.RoundWhereInput | undefined = mineCount ? { mineCount } : undefined;
  const rounds = (await prisma.round.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
  })) as RoundRow[];

  return rounds.map(toRoundLog);
}

export async function getAnalytics(userId: string, mineCount: number): Promise<AnalyticsSnapshot> {
  return prisma.$transaction(async (transaction) => {
    const [recentRoundRows, allRoundRows] = await Promise.all([
      transaction.round.findMany({
        where: { userId, mineCount },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      transaction.round.findMany({
        where: { userId, mineCount },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const recentRounds = (recentRoundRows as RoundRow[]).map(toRoundLog);
    const roundRows = allRoundRows as RoundRow[];
    const modelRounds = roundRows.map(toModelHistoryRound);

    await syncCellStatCache(transaction, userId, mineCount, modelRounds);

    const averagePredictionCount =
      roundRows.length === 0 ? 0 : roundRows.reduce((sum, round) => sum + round.predictionCount, 0) / roundRows.length;
    const artifacts = buildPredictionArtifacts(mineCount, Math.min(5, 25 - mineCount), roundRows);

    return {
      mineCount,
      totalRounds: artifacts.totalRounds,
      wins: artifacts.totalWins,
      losses: artifacts.totalLosses,
      averagePredictionCount,
      predictionMode: artifacts.decision.predictionMode,
      abstainReason: artifacts.decision.abstainReason,
      signalScore: artifacts.decision.signalScore,
      minimumRoundsForSignal: artifacts.decision.minimumRoundsForSignal,
      truthKnownRounds: artifacts.truthKnownRounds,
      truthCoverage: artifacts.totalRounds === 0 ? 0 : artifacts.truthKnownRounds / artifacts.totalRounds,
      modelVersion: MODEL_VERSION,
      deterministic: artifacts.decision.deterministic,
      averageTopSafeProbability: artifacts.decision.averageTopSafeProbability,
      averageTopUncertainty: artifacts.decision.averageTopCellUncertainty,
      decisionReasons: artifacts.decision.reasons,
      evaluationStatus: artifacts.evaluation.status,
      note: artifacts.note,
      suggestedCells: artifacts.suggestedCells,
      cells: artifacts.rankedCells,
      safestCells: artifacts.rankedCells.slice().sort((left, right) => left.riskScore - right.riskScore).slice(0, 5),
      riskiestCells: artifacts.rankedCells.slice().sort((left, right) => right.riskScore - left.riskScore).slice(0, 5),
      recentRounds,
      evaluation: artifacts.evaluation,
    };
  });
}
