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

function signedPercent(value: number) {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
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
          <p>Walk the model forward through truth-known rounds and compare it against simpler baselines without using future information.</p>
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
            <span>Evaluation status</span>
            <strong>{evaluation.status}</strong>
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
            <small>Precision@{model.precisionK}: {percent(model.precisionAtK)}</small>
            <small>Top-cell safe: {percent(model.topCellSafeRate)}</small>
            <small>Brier: {model.brierScore === null ? "-" : model.brierScore.toFixed(3)}</small>
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
                <small>{analytics.predictionMode} | {analytics.deterministic ? "Deterministic" : "Variable"}</small>
              </div>
              <span className={analytics.predictionMode === "CONFIDENT" ? "badge success-badge" : "badge warning-badge"}>
                Signal {percent(analytics.signalScore)}
              </span>
            </article>
            <article className="ranking-row">
              <div>
                <strong>Minimum sample gate</strong>
                <small>{analytics.minimumRoundsForSignal} rounds required before strong confidence is considered.</small>
              </div>
              <span className="badge">{analytics.totalRounds} logged</span>
            </article>
            <article className="ranking-row">
              <div>
                <strong>Full-board truth</strong>
                <small>The walk-forward test only judges rounds where mine locations were fully saved.</small>
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
                <small>For a durable signal, the model-minus-random safe-rate interval should stay above zero.</small>
              </div>
              <span className="badge">
                {signedPercent(evaluation.safeRateLiftVsRandom.value)} lift
              </span>
            </article>
            <article className="ranking-row">
              <div>
                <strong>Beat simple frequency</strong>
                <small>If it cannot beat a plain mine-frequency sort, the extra heuristic complexity is not helping.</small>
              </div>
              <span className="badge">
                {signedPercent(evaluation.safeRateLiftVsFrequency.value)} lift
              </span>
            </article>
            <article className="ranking-row">
              <div>
                <strong>Current caveat</strong>
                <small>{evaluation.provisionalReasons[0] ?? evaluation.note}</small>
              </div>
              <span className="badge">{percent(evaluation.truthCoverage)} truth coverage</span>
            </article>
          </div>
        </article>
      </section>
    </div>
  );
}
