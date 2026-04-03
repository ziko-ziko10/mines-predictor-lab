import Link from "next/link";

import { AuthPanel } from "@/components/auth-panel";
import { SetupCard } from "@/components/setup-card";
import { getAuthState } from "@/lib/auth";
import { cellLabel } from "@/lib/board";
import { getAnalytics, getMineCountSummaries } from "@/lib/repository";

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function interval(lower: number, upper: number) {
  return `${percent(lower)} - ${percent(upper)}`;
}

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const auth = await getAuthState();

  if (!auth.configured) {
    return <SetupCard />;
  }

  if (!auth.user) {
    return (
      <AuthPanel
        title="Sign in to open your personal analytics."
        description="Heatmaps, safest cells, and loss patterns are now calculated only from the rounds saved under your account."
      />
    );
  }

  const params = await searchParams;
  const summaries = await getMineCountSummaries(auth.user.id);
  const fallbackMineCount = summaries[0]?.mineCount ?? 3;
  const requestedMineCount = typeof params.mineCount === "string" ? Number(params.mineCount) : fallbackMineCount;
  const mineCount = Number.isFinite(requestedMineCount) ? requestedMineCount : fallbackMineCount;
  const analytics = await getAnalytics(auth.user.id, mineCount);

  return (
    <div className="page-stack">
      <section className="card page-hero-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Private Heatmap</p>
            <h1>Analytics</h1>
          </div>
          <p>Each mine count has its own heatmap, safest cells, and riskiest cells.</p>
        </div>

        <div className="hero-stat-grid compact-hero-stats">
          <article className="hero-stat-card">
            <span>Focused dataset</span>
            <strong>{analytics.mineCount} mines</strong>
            <small>This page only reads your rounds for this mine count.</small>
          </article>
          <article className="hero-stat-card">
            <span>Suggestion preview</span>
            <strong>{analytics.suggestedCells.map(cellLabel).slice(0, 3).join(" ") || "None"}</strong>
            <small>Current top cells from your saved history.</small>
          </article>
          <article className="hero-stat-card">
            <span>Model note</span>
            <strong>{analytics.totalRounds}</strong>
            <small>{analytics.note}</small>
          </article>
          <article className="hero-stat-card">
            <span>Truth coverage</span>
            <strong>{percent(analytics.truthCoverage)}</strong>
            <small>{analytics.truthKnownRounds} rounds have full board truth.</small>
          </article>
        </div>

        <div className="filter-row">
          {summaries.length === 0 ? (
            <span className="filter-chip is-active">No saved datasets yet</span>
          ) : (
            summaries.map((summary) => (
              <Link
                key={summary.mineCount}
                className={mineCount === summary.mineCount ? "filter-chip is-active" : "filter-chip"}
                href={`/analytics?mineCount=${summary.mineCount}`}
              >
                {summary.mineCount} mines
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="summary-grid">
        <article className="card stat-card">
          <strong>Rounds</strong>
          <p>{analytics.totalRounds}</p>
          <small>{analytics.note}</small>
        </article>
        <article className="card stat-card">
          <strong>Wins / losses</strong>
          <p>
            {analytics.wins} / {analytics.losses}
          </p>
          <small>Tracked only for {analytics.mineCount}-mine games.</small>
        </article>
        <article className="card stat-card">
          <strong>Average prediction size</strong>
          <p>{analytics.averagePredictionCount.toFixed(1)}</p>
          <small>User-selectable prediction count across saved rounds.</small>
        </article>
        <article className="card stat-card">
          <strong>Current mode</strong>
          <p>{analytics.predictionMode}</p>
          <small>{analytics.abstainReason ?? "The current suggestion set clears the app's minimum sample gate."}</small>
        </article>
      </section>

      <section className="card analytics-layout">
        <div className="section-heading">
          <h2>Risk heatmap</h2>
          <p>Lower risk means the cell has fewer mine reports and better play results for this mine count.</p>
        </div>

        <div className="heatmap-grid">
          {analytics.cells.map((cell) => (
            <article
              key={cell.cellIndex}
              className="heatmap-cell"
              style={{
                opacity: Math.max(0.35, 1 - cell.riskScore * 0.55),
              }}
            >
              <strong>{cellLabel(cell.cellIndex)}</strong>
              <small>Risk {percent(cell.riskScore)}</small>
              <small>Confidence {percent(cell.confidence)}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="analytics-columns">
        <article className="card">
          <div className="section-heading">
            <h2>Safest cells</h2>
            <p>Current top picks for the selected mine count.</p>
          </div>

          <div className="ranking-list">
            {analytics.safestCells.map((cell) => (
              <article key={cell.cellIndex} className="ranking-row">
                <div>
                  <strong>{cell.label}</strong>
                  <small>Risk {percent(cell.riskScore)}</small>
                  <small>Mine-rate band {interval(cell.mineRateLowerBound, cell.mineRateUpperBound)}</small>
                </div>
                <span className="badge">Mine reports {cell.mineReports}</span>
              </article>
            ))}
          </div>
        </article>

        <article className="card">
          <div className="section-heading">
            <h2>Riskiest cells</h2>
            <p>Cells the model is currently trying to avoid.</p>
          </div>

          <div className="ranking-list">
            {analytics.riskiestCells.map((cell) => (
              <article key={cell.cellIndex} className="ranking-row">
                <div>
                  <strong>{cell.label}</strong>
                  <small>Risk {percent(cell.riskScore)}</small>
                  <small>Mine-rate band {interval(cell.mineRateLowerBound, cell.mineRateUpperBound)}</small>
                </div>
                <span className="badge">Mine reports {cell.mineReports}</span>
              </article>
            ))}
          </div>
        </article>
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>Preview suggestion set</h2>
          <p>The analytics page also shows the current top five recommended cells for this mine count.</p>
        </div>
        <p className="muted-text">{analytics.suggestedCells.map(cellLabel).join(", ") || "No suggestions yet."}</p>
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>Holdout snapshot</h2>
          <p>{analytics.evaluation.note}</p>
        </div>

        <div className="summary-grid">
          <article className="card stat-card">
            <strong>Holdout rounds</strong>
            <p>{analytics.evaluation.holdoutRounds}</p>
            <small>{analytics.evaluation.reliable ? "Enough holdout data for a first pass." : "Still too small for strong trust."}</small>
          </article>
          <article className="card stat-card">
            <strong>Current model safe rate</strong>
            <p>{percent(analytics.evaluation.currentModel.averageSafeRate)}</p>
            <small>{interval(analytics.evaluation.currentModel.averageSafeRateLower, analytics.evaluation.currentModel.averageSafeRateUpper)}</small>
          </article>
          <article className="card stat-card">
            <strong>Random baseline</strong>
            <p>{percent(analytics.evaluation.randomBaseline.averageSafeRate)}</p>
            <small>Expected safe-cell rate for random picks.</small>
          </article>
        </div>
      </section>
    </div>
  );
}
