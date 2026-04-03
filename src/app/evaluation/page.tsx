import Link from "next/link";

import { AuthPanel } from "@/components/auth-panel";
import { SetupCard } from "@/components/setup-card";
import { getAuthState } from "@/lib/auth";
import { getAnalytics, getMineCountSummaries } from "@/lib/repository";

interface EvaluationPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function interval(lower: number, upper: number) {
  return `${percent(lower)} - ${percent(upper)}`;
}

export default async function EvaluationPage({ searchParams }: EvaluationPageProps) {
  const auth = await getAuthState();

  if (!auth.configured) {
    return <SetupCard />;
  }

  if (!auth.user) {
    return (
      <AuthPanel
        title="Sign in to check whether the model is earning trust."
        description="The evaluation page compares the current predictor against simpler baselines on holdout rounds with real board truth."
      />
    );
  }

  const params = await searchParams;
  const summaries = await getMineCountSummaries(auth.user.id);
  const fallbackMineCount = summaries[0]?.mineCount ?? 3;
  const requestedMineCount = typeof params.mineCount === "string" ? Number(params.mineCount) : fallbackMineCount;
  const mineCount = Number.isFinite(requestedMineCount) ? requestedMineCount : fallbackMineCount;
  const analytics = await getAnalytics(auth.user.id, mineCount);
  const { evaluation } = analytics;

  return (
    <div className="page-stack">
      <section className="card page-hero-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Reality Check</p>
            <h1>Evaluation</h1>
          </div>
          <p>Backtest the predictor on the latest truth-known rounds and compare it against simpler baselines.</p>
        </div>

        <div className="hero-stat-grid compact-hero-stats">
          <article className="hero-stat-card">
            <span>Focused dataset</span>
            <strong>{mineCount} mines</strong>
            <small>Evaluation is separated by mine count just like the live predictor.</small>
          </article>
          <article className="hero-stat-card">
            <span>Truth coverage</span>
            <strong>{percent(evaluation.truthCoverage)}</strong>
            <small>{evaluation.truthKnownRounds} rounds contain full board truth.</small>
          </article>
          <article className="hero-stat-card">
            <span>Holdout window</span>
            <strong>{evaluation.holdoutRounds}</strong>
            <small>{evaluation.note}</small>
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
                href={`/evaluation?mineCount=${summary.mineCount}`}
              >
                {summary.mineCount} mines
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="summary-grid">
        {[evaluation.currentModel, evaluation.frequencyBaseline, evaluation.randomBaseline].map((model) => (
          <article key={model.label} className="card stat-card">
            <strong>{model.label}</strong>
            <p>{percent(model.averageSafeRate)} safe-cell rate</p>
            <small>CI: {interval(model.averageSafeRateLower, model.averageSafeRateUpper)}</small>
            <small>Full survival: {percent(model.fullSurvivalRate)}</small>
            <small>Average mine hits: {model.averageMineHits.toFixed(2)}</small>
          </article>
        ))}
      </section>

      <section className="analytics-columns">
        <article className="card">
          <div className="section-heading">
            <h2>What to trust</h2>
            <p>The current model only deserves confidence if it keeps beating the simpler baselines on holdout rounds.</p>
          </div>
          <div className="ranking-list">
            <article className="ranking-row">
              <div>
                <strong>Current mode</strong>
                <small>{analytics.predictionMode}</small>
              </div>
              <span className={analytics.predictionMode === "CONFIDENT" ? "badge success-badge" : "badge warning-badge"}>
                Signal {percent(analytics.signalScore)}
              </span>
            </article>
            <article className="ranking-row">
              <div>
                <strong>Minimum sample gate</strong>
                <small>{analytics.minimumRoundsForSignal} rounds required before strong confidence.</small>
              </div>
              <span className="badge">{analytics.totalRounds} logged</span>
            </article>
            <article className="ranking-row">
              <div>
                <strong>Full-board truth</strong>
                <small>The backtest can only judge rounds where mine locations were fully saved.</small>
              </div>
              <span className="badge">{analytics.truthKnownRounds} rounds</span>
            </article>
          </div>
        </article>

        <article className="card">
          <div className="section-heading">
            <h2>Interpretation</h2>
            <p>Use these checks before trusting the live suggestions.</p>
          </div>
          <div className="ranking-list">
            <article className="ranking-row">
              <div>
                <strong>Beat random</strong>
                <small>Current model safe rate should stay above the random baseline.</small>
              </div>
              <span className="badge">
                {percent(evaluation.currentModel.averageSafeRate - evaluation.randomBaseline.averageSafeRate)} lift
              </span>
            </article>
            <article className="ranking-row">
              <div>
                <strong>Beat simple frequency</strong>
                <small>If it cannot beat a plain mine-frequency sort, the extra heuristic complexity is not helping.</small>
              </div>
              <span className="badge">
                {percent(evaluation.currentModel.averageSafeRate - evaluation.frequencyBaseline.averageSafeRate)} lift
              </span>
            </article>
            <article className="ranking-row">
              <div>
                <strong>Need more truth?</strong>
                <small>{evaluation.note}</small>
              </div>
              <span className="badge">{percent(evaluation.truthCoverage)} truth coverage</span>
            </article>
          </div>
        </article>
      </section>
    </div>
  );
}
