import { NextResponse } from "next/server";

import { getAuthState } from "@/lib/auth";
import { cellLabel } from "@/lib/board";
import { getAdminRecentRounds, getRecentRounds } from "@/lib/repository";

type ExportFormat = "csv" | "json";

function escapeCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function formatCells(cells: number[]) {
  if (cells.length === 0) {
    return "";
  }

  return cells.map(cellLabel).join(", ");
}

function buildFileName(scope: "mine" | "all", format: ExportFormat, mineCount?: number) {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = mineCount ? `${mineCount}-mines` : "all-mine-counts";
  const prefix = scope === "all" ? "admin-logs" : "my-logs";

  return `${prefix}-${suffix}-${stamp}.${format}`;
}

function parseMineCount(value: string | null) {
  const parsed = value ? Number(value) : undefined;
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const auth = await getAuthState();

  if (!auth.configured) {
    return NextResponse.json({ error: "Supabase auth is not configured." }, { status: 503 });
  }

  if (!auth.user) {
    return NextResponse.json({ error: "Sign in is required." }, { status: 401 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "json" ? "json" : "csv";
  const scope = url.searchParams.get("scope") === "all" ? "all" : "mine";
  const mineCount = parseMineCount(url.searchParams.get("mineCount"));

  if (scope === "all" && !auth.isAdmin) {
    return NextResponse.json({ error: "Admin access is required for global log exports." }, { status: 403 });
  }

  const rounds =
    scope === "all"
      ? await getAdminRecentRounds(mineCount, 5000)
      : await getRecentRounds(auth.user.id, mineCount, 5000);

  if (format === "json") {
    return new NextResponse(JSON.stringify(rounds, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildFileName(scope, format, mineCount)}"`,
      },
    });
  }

  const header = [
    "id",
    "userId",
    "mineCount",
    "predictionCount",
    "predictionMode",
    "result",
    "hitCell",
    "predictedCells",
    "playedCells",
    "mineLocations",
    "serverSeed",
    "clientSeed",
    "nonce",
    "createdAt",
  ];

  const rows = rounds.map((round) =>
    [
      round.id,
      round.userId,
      String(round.mineCount),
      String(round.predictionCount),
      round.predictionMode,
      round.result,
      round.hitCell ? cellLabel(round.hitCell) : "",
      formatCells(round.predictedCells),
      formatCells(round.playedCells),
      formatCells(round.mineLocations),
      round.serverSeed ?? "",
      round.clientSeed ?? "",
      round.nonce ?? "",
      round.createdAt,
    ]
      .map((value) => escapeCsv(value))
      .join(","),
  );

  const csv = [header.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${buildFileName(scope, format, mineCount)}"`,
    },
  });
}
