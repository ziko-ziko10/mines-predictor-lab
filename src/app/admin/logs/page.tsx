import Link from "next/link";

import { AuthPanel } from "@/components/auth-panel";
import { SetupCard } from "@/components/setup-card";
import { getAuthState } from "@/lib/auth";
import { cellLabel } from "@/lib/board";
import { getAdminRecentRounds, getGlobalMineCountSummaries } from "@/lib/repository";

interface AdminLogsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function formatCells(cells: number[]) {
  if (cells.length === 0) {
    return "-";
  }

  return cells.map(cellLabel).join(", ");
}

function shortenUserId(userId: string) {
  return userId.length <= 16 ? userId : `${userId.slice(0, 8)}...${userId.slice(-4)}`;
}

export default async function AdminLogsPage({ searchParams }: AdminLogsPageProps) {
  const auth = await getAuthState();

  if (!auth.configured) {
    return <SetupCard />;
  }

  if (!auth.user) {
    return (
      <AuthPanel
        title="Sign in to open admin logs."
        description="Admin access is required before global logs can be opened."
      />
    );
  }

  if (!auth.isAdmin) {
    return (
      <div className="page-stack">
        <section className="card empty-state">
          <h1>Admin access required</h1>
          <p>Add your email to `ADMIN_EMAILS` in the environment configuration, then sign in again.</p>
        </section>
      </div>
    );
  }

  const params = await searchParams;
  const selectedMineCount = typeof params.mineCount === "string" ? Number(params.mineCount) : undefined;
  const summaries = await getGlobalMineCountSummaries();
  const rounds = await getAdminRecentRounds(Number.isFinite(selectedMineCount) ? selectedMineCount : undefined);
  const totalRounds = summaries.reduce((sum, summary) => sum + summary.totalRounds, 0);
  const totalWins = summaries.reduce((sum, summary) => sum + summary.wins, 0);

  return (
    <div className="page-stack">
      <section className="card page-hero-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Admin Archive</p>
            <h1>All Logs</h1>
          </div>
          <p>Review recent rounds across every user account. This page bypasses the normal per-user privacy filter for admins only.</p>
        </div>

        <div className="hero-stat-grid compact-hero-stats">
          <article className="hero-stat-card">
            <span>Total rounds</span>
            <strong>{totalRounds}</strong>
            <small>Across all users and mine-count datasets.</small>
          </article>
          <article className="hero-stat-card">
            <span>Total wins</span>
            <strong>{totalWins}</strong>
            <small>All successful rounds from the global archive.</small>
          </article>
          <article className="hero-stat-card">
            <span>Current filter</span>
            <strong>{selectedMineCount ? `${selectedMineCount} mines` : "All mine counts"}</strong>
            <small>Use the chips below to narrow the global log view.</small>
          </article>
        </div>

        <div className="filter-row">
          <Link className={!selectedMineCount ? "filter-chip is-active" : "filter-chip"} href="/admin/logs">
            All mine counts
          </Link>
          {summaries.map((summary) => (
            <Link
              key={summary.mineCount}
              className={selectedMineCount === summary.mineCount ? "filter-chip is-active" : "filter-chip"}
              href={`/admin/logs?mineCount=${summary.mineCount}`}
            >
              {summary.mineCount} mines
            </Link>
          ))}
        </div>
      </section>

      <section className="summary-grid">
        {summaries.length === 0 ? (
          <article className="card empty-state">
            <h2>No global logs yet</h2>
            <p>Rounds from all users will appear here once people start saving results.</p>
          </article>
        ) : (
          summaries.map((summary) => (
            <article key={summary.mineCount} className="card stat-card">
              <strong>{summary.mineCount} mines</strong>
              <p>{summary.totalRounds} rounds</p>
              <small>
                {summary.wins} wins / {summary.losses} losses
              </small>
            </article>
          ))
        )}
      </section>

      <section className="card log-list-card">
        <div className="section-heading">
          <h2>Recent rounds across all users</h2>
          <p>{selectedMineCount ? `Showing only ${selectedMineCount}-mine rounds.` : "Showing the newest rounds from every user."}</p>
        </div>

        {rounds.length === 0 ? (
          <div className="empty-state compact-empty">
            <p>No rounds match this filter yet.</p>
          </div>
        ) : (
          <div className="log-list">
            {rounds.map((round) => (
              <article key={round.id} className="log-card">
                <div className="log-card-top">
                  <strong>
                    {round.result === "WON" ? "Win" : "Loss"} | {round.mineCount} mines
                  </strong>
                  <div className="ranking-metrics">
                    <span className={round.result === "WON" ? "badge success-badge" : "badge danger-badge"}>{round.result}</span>
                    <span className={round.predictionMode === "CONFIDENT" ? "badge success-badge" : "badge warning-badge"}>
                      {round.predictionMode}
                    </span>
                    <span className="badge">User {shortenUserId(round.userId)}</span>
                  </div>
                </div>

                <p>{new Date(round.createdAt).toLocaleString()}</p>
                <small>Owner ID: {round.userId}</small>
                <small>Predicted: {formatCells(round.predictedCells)}</small>
                <small>Played: {formatCells(round.playedCells)}</small>
                <small>Hit cell: {round.hitCell ? cellLabel(round.hitCell) : "-"}</small>
                <small>Mine locations: {formatCells(round.mineLocations)}</small>
                <small>Server seed: {round.serverSeed ?? "-"}</small>
                <small>Client seed: {round.clientSeed ?? "-"}</small>
                <small>Nonce: {round.nonce ?? "-"}</small>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
