import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { normalizeCells, parseCells, serializeCells } from "@/lib/board";
import type {
  AnalyticsSnapshot,
  MineCountSummary,
  PredictionResponse,
  RoundLog,
  RoundSubmission,
} from "@/lib/contracts";
import { buildHoldoutEvaluation } from "@/lib/evaluation";
import { buildCellInsights, buildPredictionDecision, buildPredictorNote, pickSuggestedCells } from "@/lib/predictor";
import { roundSubmissionSchema } from "@/lib/validators";

function toRoundLog(round: {
  id: string;
  mineCount: number;
  predictionCount: number;
  predictionMode: "CONFIDENT" | "EXPLORATORY" | "ABSTAIN";
  predictedCells: string;
  playedCells: string | null;
  result: "WON" | "LOST";
  hitCell: number | null;
  mineLocations: string | null;
  serverSeed: string | null;
  clientSeed: string | null;
  nonce: string | null;
  createdAt: Date;
}): RoundLog {
  return {
    id: round.id,
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

export async function getPrediction(userId: string, mineCount: number, predictionCount: number): Promise<PredictionResponse> {
  const [rounds, stats, recentPredictionRows] = await prisma.$transaction([
    prisma.round.findMany({
      where: { userId, mineCount },
      select: { result: true, mineLocations: true },
    }),
    prisma.cellStat.findMany({
      where: { userId, mineCount },
      orderBy: { cellIndex: "asc" },
    }),
    prisma.round.findMany({
      where: { userId, mineCount },
      select: { predictedCells: true },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const totalRounds = rounds.length;
  const totalWins = rounds.filter((round) => round.result === "WON").length;
  const totalLosses = totalRounds - totalWins;
  const truthKnownRounds = rounds.filter((round) => Boolean(round.mineLocations)).length;
  const rankedCells = buildCellInsights({
    mineCount,
    totalRounds,
    totalLosses,
    truthKnownRounds,
    stats,
  });
  const recentPredictions = recentPredictionRows.map((row) => parseCells(row.predictedCells));
  const decision = buildPredictionDecision(rankedCells, predictionCount, totalRounds, truthKnownRounds);
  const suggestedCells = pickSuggestedCells(rankedCells, predictionCount, recentPredictions);
  const modeNote =
    decision.predictionMode === "CONFIDENT"
      ? "Signal quality is currently above the app's minimum confidence gate."
      : decision.predictionMode === "EXPLORATORY"
        ? decision.abstainReason ?? "Signal quality is still exploratory for this mine count."
        : `${decision.abstainReason ?? "The model abstained."} The cells below are exploratory only.`;

  return {
    mineCount,
    predictionCount,
    totalRounds,
    totalWins,
    totalLosses,
    predictionMode: decision.predictionMode,
    abstainReason: decision.abstainReason,
    signalScore: decision.signalScore,
    minimumRoundsForSignal: decision.minimumRoundsForSignal,
    truthKnownRounds,
    truthCoverage: totalRounds === 0 ? 0 : truthKnownRounds / totalRounds,
    note: `${buildPredictorNote(totalRounds, totalLosses)} ${modeNote}`,
    suggestedCells,
    rankedCells,
  };
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
    predictionMode: "CONFIDENT" | "EXPLORATORY" | "ABSTAIN";
    result: "WON" | "LOST";
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

    const deltas = new Map<
      number,
      {
        timesPredicted: number;
        timesPlayed: number;
        mineReports: number;
        winCount: number;
        lossCount: number;
      }
    >();

    function bump(
      cellIndex: number,
      update: Partial<{
        timesPredicted: number;
        timesPlayed: number;
        mineReports: number;
        winCount: number;
        lossCount: number;
      }>,
    ) {
      const existing = deltas.get(cellIndex) ?? {
        timesPredicted: 0,
        timesPlayed: 0,
        mineReports: 0,
        winCount: 0,
        lossCount: 0,
      };

      deltas.set(cellIndex, {
        timesPredicted: existing.timesPredicted + (update.timesPredicted ?? 0),
        timesPlayed: existing.timesPlayed + (update.timesPlayed ?? 0),
        mineReports: existing.mineReports + (update.mineReports ?? 0),
        winCount: existing.winCount + (update.winCount ?? 0),
        lossCount: existing.lossCount + (update.lossCount ?? 0),
      });
    }

    for (const cell of parsed.predictedCells) {
      bump(cell, { timesPredicted: 1 });
    }

    for (const cell of parsed.playedCells) {
      bump(cell, { timesPlayed: 1, winCount: parsed.result === "WON" ? 1 : 0 });
    }

    for (const cell of parsed.mineLocations) {
      bump(cell, { mineReports: 1 });
    }

    if (parsed.result === "LOST" && parsed.hitCell) {
      bump(parsed.hitCell, { lossCount: 1, timesPlayed: 1 });
    }

    for (const [cellIndex, delta] of deltas.entries()) {
      await transaction.cellStat.upsert({
        where: {
          userId_mineCount_cellIndex: {
            userId,
            mineCount: parsed.mineCount,
            cellIndex,
          },
        },
        create: {
          userId,
          mineCount: parsed.mineCount,
          cellIndex,
          ...delta,
        },
        update: {
          timesPredicted: {
            increment: delta.timesPredicted,
          },
          timesPlayed: {
            increment: delta.timesPlayed,
          },
          mineReports: {
            increment: delta.mineReports,
          },
          winCount: {
            increment: delta.winCount,
          },
          lossCount: {
            increment: delta.lossCount,
          },
        },
      });
    }

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
  const rounds = await prisma.round.findMany({
    where,
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
  });

  return rounds.map(toRoundLog);
}

export async function getAnalytics(userId: string, mineCount: number): Promise<AnalyticsSnapshot> {
  const [recentRoundRows, allRoundRows, cellStats] = await prisma.$transaction([
    prisma.round.findMany({
      where: { userId, mineCount },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.round.findMany({
      where: { userId, mineCount },
      orderBy: { createdAt: "desc" },
    }),
    prisma.cellStat.findMany({
      where: { userId, mineCount },
      orderBy: { cellIndex: "asc" },
    }),
  ]);

  const recentRounds = recentRoundRows.map(toRoundLog);
  const totalRounds = allRoundRows.length;
  const wins = allRoundRows.filter((round) => round.result === "WON").length;
  const losses = totalRounds - wins;
  const truthKnownRounds = allRoundRows.filter((round) => Boolean(round.mineLocations)).length;
  const averagePredictionCount =
    totalRounds === 0
      ? 0
      : allRoundRows.reduce((sum, round) => sum + round.predictionCount, 0) / totalRounds;
  const cells = buildCellInsights({
    mineCount,
    totalRounds,
    totalLosses: losses,
    truthKnownRounds,
    stats: cellStats,
  });
  const decision = buildPredictionDecision(cells, Math.min(5, 25 - mineCount), totalRounds, truthKnownRounds);
  const recentPredictions = allRoundRows.slice(0, 8).map((row) => parseCells(row.predictedCells));
  const suggestedCells = pickSuggestedCells(cells, Math.min(5, 25 - mineCount), recentPredictions);
  const evaluation = buildHoldoutEvaluation(
    mineCount,
    allRoundRows.map((row) => ({
      id: row.id,
      predictionCount: row.predictionCount,
      predictedCells: parseCells(row.predictedCells),
      playedCells: parseCells(row.playedCells),
      result: row.result,
      hitCell: row.hitCell,
      mineLocations: parseCells(row.mineLocations),
      createdAt: row.createdAt,
    })),
  );
  const modeNote =
    decision.predictionMode === "CONFIDENT"
      ? "The current suggestion set clears the minimum confidence gate for this dataset."
      : decision.abstainReason ?? "The current suggestion set is still exploratory.";

  return {
    mineCount,
    totalRounds,
    wins,
    losses,
    averagePredictionCount,
    predictionMode: decision.predictionMode,
    abstainReason: decision.abstainReason,
    signalScore: decision.signalScore,
    minimumRoundsForSignal: decision.minimumRoundsForSignal,
    truthKnownRounds,
    truthCoverage: totalRounds === 0 ? 0 : truthKnownRounds / totalRounds,
    note: `${buildPredictorNote(totalRounds, losses)} ${modeNote}`,
    suggestedCells,
    cells,
    safestCells: cells.slice().sort((left, right) => left.riskScore - right.riskScore).slice(0, 5),
    riskiestCells: cells.slice().sort((left, right) => right.riskScore - left.riskScore).slice(0, 5),
    recentRounds,
    evaluation,
  };
}
