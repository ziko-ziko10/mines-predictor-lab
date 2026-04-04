import Link from "next/link";

import { AuthPanel } from "@/components/auth-panel";
import { SetupCard } from "@/components/setup-card";
import { getAuthState } from "@/lib/auth";
import { cellLabel } from "@/lib/board";
import { getMineCountSummaries, getRecentRounds } from "@/lib/repository";

interface LogsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function formatCells(cells: number[]) {
  if (cells.length === 0) {
    return "-";
  }

  return cells.map(cellLabel).join(", ");
}

export default async function LogsPage({ searchParams }: LogsPageProps) {
  const auth = await getAuthState();

  if (!auth.configured) {
    return <SetupCard />;
  }

  if (!auth.user) {
    return (
      <AuthPanel
        title="Sign in to review your round history."
        description="Logs are now tied to the signed-in account, so only your own wins and losses appear here."
      />
    );
  }

  const params = await searchParams;
  const selectedMineCount = typeof params.mineCount === "string" ? Number(params.mineCount) : undefined;
  const summaries = await getMineCountSummaries(auth.user.id);
  const rounds = await getRecentRounds(auth.user.id, Number.isFinite(selectedMineCount) ? selectedMineCount : undefined);
  const totalRounds = summaries.reduce((sum, summary) => sum + summary.totalRounds, 0);
  const totalWins = summaries.reduce((sum, summary) => sum + summary.wins, 0);
  const exportQuery = selectedMineCount ? `?mineCount=${selectedMineCount}` : "";
  const csvExportHref = `/api/logs/export${exportQuery}`;
  const jsonExportHref = `/api/logs/export${exportQuery}${exportQuery ? "&" : "?"}format=json`;

  return (
    <div className="page-stack">
      <section className="card page-hero-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Round Archive</p>
            <h1>Logs</h1>
          </div>
          <p>Review every saved round, filtered by mine count when needed.</p>
        </div>

        <div className="hero-stat-grid compact-hero-stats">
          <article className="hero-stat-card">
            <span>Total rounds</span>
            <strong>{totalRounds}</strong>
            <small>Everything saved under your account.</small>
          </article>
          <article className="hero-stat-card">
            <span>Wins</span>
            <strong>{totalWins}</strong>
            <small>Successful rounds recorded so far.</small>
          </article>
          <article className="hero-stat-card">
            <span>Current filter</span>
            <strong>{selectedMineCount ? `${selectedMineCount} mines` : "All datasets"}</strong>
            <small>Switch mine counts from the chip row below.</small>
          </article>
        </div>

        <div className="filter-row">
          <Link className={!selectedMineCount ? "filter-chip is-active" : "filter-chip"} href="/logs">
            All mine counts
          </Link>
          {summaries.map((summary) => (
            <Link
              key={summary.mineCount}
              className={selectedMineCount === summary.mineCount ? "filter-chip is-active" : "filter-chip"}
              href={`/logs?mineCount=${summary.mineCount}`}
            >
              {summary.mineCount} mines
            </Link>
          ))}
        </div>

        <div className="button-row">
          <a className="ghost-button" href={csvExportHref}>
            Download CSV
          </a>
          <a className="ghost-button" href={jsonExportHref}>
            Download JSON
          </a>
        </div>
      </section>

      <section className="summary-grid">
        {summaries.length === 0 ? (
          <article className="card empty-state">
            <h2>No logs yet</h2>
            <p>Saved rounds will appear here after you use the predictor page.</p>
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
          <h2>Recent rounds</h2>
          <p>{selectedMineCount ? `Showing only ${selectedMineCount}-mine rounds.` : "Showing all mine counts."}</p>
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
                    <span className="badge">{round.mineLocations.length === round.mineCount ? "Full board known" : "Partial truth"}</span>
                  </div>
                </div>

                <p>{new Date(round.createdAt).toLocaleString()}</p>
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
