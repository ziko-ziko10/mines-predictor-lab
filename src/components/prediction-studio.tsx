"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { BOARD_CELL_COUNT, MINE_COUNT_OPTIONS, cellLabel, clampPredictionCount } from "@/lib/board";
import type { MineCountSummary, PredictionResponse, RoundResult } from "@/lib/contracts";

interface PredictionStudioProps {
  summaries: MineCountSummary[];
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "No rounds logged yet";
  }

  return new Date(value).toLocaleString();
}

function toggleCell(current: number[], cellIndex: number) {
  return current.includes(cellIndex)
    ? current.filter((cell) => cell !== cellIndex)
    : [...current, cellIndex].sort((left, right) => left - right);
}

function toggleMineCell(current: number[], cellIndex: number, mineCount: number) {
  if (current.includes(cellIndex)) {
    return current.filter((cell) => cell !== cellIndex);
  }

  if (current.length >= mineCount) {
    return current;
  }

  return [...current, cellIndex].sort((left, right) => left - right);
}

function deriveAutoDetectedOutcome(playedCells: number[], mineLocations: number[]) {
  const hitCandidates = playedCells.filter((cell) => mineLocations.includes(cell));

  return {
    result: hitCandidates.length > 0 ? ("LOST" as const) : ("WON" as const),
    hitCandidates,
    autoHitCell: hitCandidates.length === 1 ? hitCandidates[0] : null,
  };
}

function Board({
  title,
  selectedCells,
  suggestedCells = [],
  mineCells = [],
  hitCell = null,
  lockedCells = [],
  disabled = false,
  selectedNumberTone = "default",
  onSelect,
}: {
  title: string;
  selectedCells: number[];
  suggestedCells?: number[];
  mineCells?: number[];
  hitCell?: number | null;
  lockedCells?: number[];
  disabled?: boolean;
  selectedNumberTone?: "default" | "warning";
  onSelect?: (cellIndex: number) => void;
}) {
  return (
    <section className="card grid-card">
      <div className="section-heading">
        <h3>{title}</h3>
        <p>Tap cells on the 5x5 board to update the round.</p>
      </div>

      <div className="board-grid">
        {Array.from({ length: BOARD_CELL_COUNT }, (_, index) => {
          const cellIndex = index + 1;
          const isSelected = selectedCells.includes(cellIndex);
          const isSuggested = suggestedCells.includes(cellIndex);
          const isMine = mineCells.includes(cellIndex);
          const isLocked = lockedCells.length > 0 && !lockedCells.includes(cellIndex);
          const isHit = hitCell === cellIndex;

          const className = [
            "board-cell",
            isSelected ? "is-selected" : "",
            isSuggested ? "is-suggested" : "",
            isMine ? "is-mine" : "",
            isHit ? "is-hit" : "",
            isLocked ? "is-locked" : "",
            isSelected && selectedNumberTone === "warning" ? "has-warning-number" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <button
              key={cellIndex}
              type="button"
              className={className}
              disabled={disabled || isLocked}
              onClick={() => onSelect?.(cellIndex)}
            >
              <span>{cellLabel(cellIndex)}</span>
              <small>#{cellIndex}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function PredictionStudio({ summaries }: PredictionStudioProps) {
  const router = useRouter();
  const [mineCount, setMineCount] = useState(3);
  const [predictionCount, setPredictionCount] = useState(3);
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [result, setResult] = useState<RoundResult>("WON");
  const [playedCells, setPlayedCells] = useState<number[]>([]);
  const [mineLocations, setMineLocations] = useState<number[]>([]);
  const [hitCell, setHitCell] = useState<number | null>(null);
  const [knowFullMineLayout, setKnowFullMineLayout] = useState(false);
  const [serverSeed, setServerSeed] = useState("");
  const [clientSeed, setClientSeed] = useState("");
  const [nonce, setNonce] = useState("");
  const [showAdvancedMeta, setShowAdvancedMeta] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPredicting, startPrediction] = useTransition();
  const [isSaving, startSaving] = useTransition();

  const maxPredictionCount = BOARD_CELL_COUNT - mineCount;
  const totalRoundsTracked = summaries.reduce((sum, summary) => sum + summary.totalRounds, 0);
  const totalWinsTracked = summaries.reduce((sum, summary) => sum + summary.wins, 0);
  const hottestDataset = summaries.slice().sort((left, right) => right.totalRounds - left.totalRounds)[0] ?? null;
  const fullTruthReady = mineLocations.length === mineCount;
  const autoDetection = playedCells.length > 0 && fullTruthReady ? deriveAutoDetectedOutcome(playedCells, mineLocations) : null;
  const resolvedResult = autoDetection?.result ?? result;
  const requiresManualHitChoice = autoDetection?.result === "LOST" && autoDetection.hitCandidates.length > 1;
  const resolvedHitCell = autoDetection?.result === "LOST" ? autoDetection.autoHitCell ?? hitCell : result === "LOST" ? hitCell : null;
  const showMineLocationBoard = knowFullMineLayout || result === "LOST";

  function resetRoundState(nextPrediction: PredictionResponse | null = null) {
    setPrediction(nextPrediction);
    setResult("WON");
    setPlayedCells([]);
    setMineLocations([]);
    setHitCell(null);
    setKnowFullMineLayout(false);
    setServerSeed("");
    setClientSeed("");
    setNonce("");
    setShowAdvancedMeta(false);
  }

  function requestPrediction() {
    setError(null);
    setMessage(null);

    startPrediction(async () => {
      try {
        const response = await fetch(`/api/predict?mineCount=${mineCount}&predictionCount=${predictionCount}`);
        const payload = (await response.json()) as PredictionResponse | { error: string };

        if (!response.ok) {
          throw new Error("error" in payload ? payload.error : "Prediction failed.");
        }

        if ("error" in payload) {
          throw new Error(payload.error);
        }

        resetRoundState(payload);
      } catch (caughtError) {
        const nextError = caughtError instanceof Error ? caughtError.message : "Prediction failed.";
        setError(nextError);
      }
    });
  }

  function submitRound() {
    if (!prediction) {
      setError("Generate a prediction before saving a round.");
      return;
    }

    if (playedCells.length === 0) {
      setError("Select the predicted cells that were actually played in the round.");
      return;
    }

    if (autoDetection && autoDetection.result === "LOST" && !resolvedHitCell) {
      setError("Select which overlapping played cell actually caused the loss.");
      return;
    }

    if (!autoDetection && result === "LOST" && mineLocations.length !== mineCount) {
      setError(`Select exactly ${mineCount} mine cells before saving the loss.`);
      return;
    }

    if (!autoDetection && result === "LOST" && !hitCell) {
      setError("Select the hit cell before saving the loss.");
      return;
    }

    if (!autoDetection && result === "WON" && knowFullMineLayout && mineLocations.length !== mineCount) {
      setError(`Select exactly ${mineCount} mine cells if you know the full board.`);
      return;
    }

    const finalResult = autoDetection?.result ?? result;
    const finalMineLocations = showMineLocationBoard ? mineLocations : [];
    const finalHitCell = finalResult === "LOST" ? resolvedHitCell : null;

    setError(null);
    setMessage(null);

    startSaving(async () => {
      try {
        const response = await fetch("/api/rounds", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            mineCount: prediction.mineCount,
            predictionCount: prediction.predictionCount,
            predictedCells: prediction.suggestedCells,
            predictionMode: prediction.predictionMode,
            result: finalResult,
            playedCells,
            hitCell: finalHitCell,
            mineLocations: finalMineLocations,
            serverSeed,
            clientSeed,
            nonce,
          }),
        });
        const payload = (await response.json()) as { ok?: boolean; error?: string };

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Failed to save the round.");
        }

        setMessage("Round saved. The dataset for this mine count has been updated.");
        resetRoundState(null);
        router.refresh();
      } catch (caughtError) {
        const nextError = caughtError instanceof Error ? caughtError.message : "Failed to save the round.";
        setError(nextError);
      }
    });
  }

  function handleMineCountChange(nextMineCount: number) {
    const nextPredictionCount = clampPredictionCount(nextMineCount, predictionCount);
    setMineCount(nextMineCount);
    setPredictionCount(nextPredictionCount);
    resetRoundState(null);
    setMessage(null);
    setError(null);
  }

  return (
    <div className="page-stack">
      <section className="hero card">
        <div className="hero-copy">
          <p className="eyebrow">Mines Predictor Lab</p>
          <h1>Predict first, then train the board with real outcomes.</h1>
          <p>
            Each mine count keeps its own history inside your account. Wins record which predicted cells were actually
            used, and losses record the full mine layout plus the hit cell.
          </p>
        </div>
        <div className="hero-side">
          <div className="hero-links">
            <Link className="ghost-button" href="/logs">
              View logs
            </Link>
            <Link className="ghost-button" href="/analytics">
              View analytics
            </Link>
          </div>

          <div className="hero-stat-grid">
            <article className="hero-stat-card">
              <span>Account rounds</span>
              <strong>{totalRoundsTracked}</strong>
              <small>All saved rounds across your mine-count datasets.</small>
            </article>
            <article className="hero-stat-card">
              <span>Wins tracked</span>
              <strong>{totalWinsTracked}</strong>
              <small>Winning rounds that already trained the predictor.</small>
            </article>
            <article className="hero-stat-card">
              <span>Most active dataset</span>
              <strong>{hottestDataset ? `${hottestDataset.mineCount} mines` : "None yet"}</strong>
              <small>{hottestDataset ? `${hottestDataset.totalRounds} rounds logged` : "Start with your first prediction."}</small>
            </article>
          </div>
        </div>
      </section>

      <section className="summary-grid">
        {summaries.length === 0 ? (
          <article className="card empty-state">
            <h2>No datasets yet</h2>
            <p>Generate a prediction, play a round, then come back here to start building history.</p>
          </article>
        ) : (
          summaries.map((summary) => (
            <article key={summary.mineCount} className="card stat-card">
              <div className="stat-card-top">
                <strong>{summary.mineCount} mines</strong>
                <span className="badge">{percent(summary.winRate)} win rate</span>
              </div>
              <p>{summary.totalRounds} rounds logged</p>
              <small>
                {summary.wins} wins / {summary.losses} losses
              </small>
              <small>Last update: {formatDate(summary.lastPlayedAt)}</small>
            </article>
          ))
        )}
      </section>

      <section className="card form-card">
        <div className="section-heading">
          <h2>1. Generate prediction</h2>
          <p>Pick the mine count and how many suggested cells you want back.</p>
        </div>

        <div className="form-grid">
          <label>
            <span>Mine count</span>
            <select value={mineCount} onChange={(event) => handleMineCountChange(Number(event.target.value))}>
              {MINE_COUNT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>Prediction count</span>
            <input
              type="number"
              min={1}
              max={maxPredictionCount}
              value={predictionCount}
              onChange={(event) => setPredictionCount(clampPredictionCount(mineCount, Number(event.target.value) || 1))}
            />
          </label>
        </div>

        <div className="button-row">
          <button className="primary-button" type="button" onClick={requestPrediction} disabled={isPredicting || isSaving}>
            {isPredicting ? "Generating..." : "Generate prediction"}
          </button>
        </div>

        {prediction ? (
          <div className="prediction-meta">
            <span className="badge">{prediction.totalRounds} rounds in this dataset</span>
            <span className="badge">{prediction.totalWins} wins</span>
            <span className="badge">{prediction.totalLosses} losses</span>
            <span className="badge">{prediction.truthKnownRounds} full-board rounds</span>
            <span className={prediction.predictionMode === "CONFIDENT" ? "badge success-badge" : "badge warning-badge"}>
              {prediction.predictionMode}
            </span>
          </div>
        ) : null}

        {prediction ? <p className="muted-text">{prediction.note}</p> : null}
        {prediction ? <p className="suggestion-line">Current suggested set: {prediction.suggestedCells.map(cellLabel).join(", ")}</p> : null}
        {prediction ? (
          <p className="muted-text">
            Signal score {percent(prediction.signalScore)} | Truth coverage {percent(prediction.truthCoverage)} | Minimum rounds for signal {prediction.minimumRoundsForSignal}
          </p>
        ) : null}
      </section>

      {prediction ? (
        <>
          {prediction.predictionMode === "CONFIDENT" ? null : (
            <section className="notice-banner warning-banner">
              <strong>{prediction.predictionMode === "ABSTAIN" ? "Model abstained" : "Exploratory mode"}</strong>
              <p className="muted-text">
                {prediction.abstainReason ?? "This set is being shown for data gathering and comparison, not as a trusted high-signal prediction."}
              </p>
            </section>
          )}

          <Board
            title={prediction.predictionMode === "CONFIDENT" ? "2. Suggested cells" : "2. Exploratory cells"}
            selectedCells={prediction.suggestedCells}
            suggestedCells={prediction.suggestedCells}
          />

          <section className="card form-card">
            <div className="section-heading">
              <h2>3. Save the result</h2>
              <p>After you play the round in the other game, come back and log the outcome here. More full-board truth means a more honest model.</p>
            </div>

            <p className="muted-text">Select which predicted cells you actually used. If you also enter the full mine layout, the app will auto-detect win or loss.</p>

            <div className="button-row compact-actions">
              <button type="button" className="secondary-button" onClick={() => setPlayedCells(prediction.suggestedCells)}>
                Select all predicted
              </button>
              <button type="button" className="secondary-button" onClick={() => setPlayedCells([])}>
                Clear selection
              </button>
            </div>

            <Board
              title="Played predicted cells"
              selectedCells={playedCells}
              suggestedCells={prediction.suggestedCells}
              lockedCells={prediction.suggestedCells}
              onSelect={(cellIndex) => setPlayedCells((current) => toggleCell(current, cellIndex))}
            />

            <div className="truth-toggle-row">
              <button
                type="button"
                className={knowFullMineLayout ? "segment is-active" : "segment"}
                onClick={() => {
                  setKnowFullMineLayout((current) => {
                    const next = !current;

                    if (!next && result !== "LOST") {
                      setMineLocations([]);
                      setHitCell(null);
                    }

                    return next;
                  });
                }}
              >
                {knowFullMineLayout ? "Full board enabled" : "I know the full board"}
              </button>
            </div>

            {showMineLocationBoard ? (
              <div className="loss-grid-layout">
                <Board
                  title={`Mine locations (${mineLocations.length}/${mineCount})`}
                  selectedCells={mineLocations}
                  mineCells={mineLocations}
                  onSelect={(cellIndex) => {
                    setMineLocations((current) => {
                        const next = toggleMineCell(current, cellIndex, mineCount);

                        if (hitCell && !next.includes(hitCell)) {
                          setHitCell(null);
                        }

                      return next;
                    });
                  }}
                />

                {resolvedResult === "LOST" ? (
                  <Board
                    title={requiresManualHitChoice ? "Actual hit cell" : "Detected hit cell"}
                    selectedCells={resolvedHitCell ? [resolvedHitCell] : []}
                    mineCells={mineLocations}
                    lockedCells={requiresManualHitChoice ? autoDetection?.hitCandidates ?? mineLocations : resolvedHitCell ? [resolvedHitCell] : []}
                    disabled={!requiresManualHitChoice}
                    selectedNumberTone="warning"
                    onSelect={(cellIndex) => setHitCell(cellIndex)}
                  />
                ) : null}
              </div>
            ) : null}

            {autoDetection ? (
              <section className={autoDetection.result === "WON" ? "notice-banner success-banner" : "notice-banner warning-banner"}>
                <strong>Auto-detected result: {autoDetection.result}</strong>
                <p className="muted-text">
                  {autoDetection.result === "WON"
                    ? "None of the played predicted cells overlap the reported mine locations."
                    : requiresManualHitChoice
                      ? "More than one played cell overlaps the mine layout. Pick the actual hit cell above."
                      : `The hit cell was auto-detected as ${cellLabel(resolvedHitCell ?? autoDetection.autoHitCell ?? autoDetection.hitCandidates[0] ?? 1)}.`}
                </p>
              </section>
            ) : null}

            {!autoDetection ? (
              <>
                <p className="muted-text">If you do not know the full board, use the manual status fallback below.</p>
                <div className="button-row segmented-row">
                  <button
                    type="button"
                    className={result === "WON" ? "segment is-active" : "segment"}
                    onClick={() => {
                      setResult("WON");
                      if (!knowFullMineLayout) {
                        setMineLocations([]);
                      }
                      setHitCell(null);
                    }}
                  >
                    Won
                  </button>
                  <button
                    type="button"
                    className={result === "LOST" ? "segment is-active" : "segment"}
                    onClick={() => {
                      setResult("LOST");
                      setKnowFullMineLayout(true);
                    }}
                  >
                    Lost
                  </button>
                </div>

                {result === "LOST" ? (
                  <Board
                    title="Hit cell"
                    selectedCells={hitCell ? [hitCell] : []}
                    mineCells={mineLocations}
                    lockedCells={mineLocations}
                    selectedNumberTone="warning"
                    onSelect={(cellIndex) => setHitCell(cellIndex)}
                  />
                ) : null}
              </>
            ) : null}

            <section className="card tone-panel verifier-panel">
              <div className="section-heading">
                <h3>Provably fair metadata</h3>
                <p>Optional. Save seeds or nonce here if the external game exposes them, so verifier support can be added later.</p>
              </div>
              <div className="button-row compact-actions">
                <button type="button" className="secondary-button" onClick={() => setShowAdvancedMeta((value) => !value)}>
                  {showAdvancedMeta ? "Hide fairness fields" : "Add fairness fields"}
                </button>
              </div>

              {showAdvancedMeta ? (
                <div className="form-grid">
                  <label>
                    <span>Server seed</span>
                    <input type="text" value={serverSeed} onChange={(event) => setServerSeed(event.target.value)} placeholder="Optional" />
                  </label>
                  <label>
                    <span>Client seed</span>
                    <input type="text" value={clientSeed} onChange={(event) => setClientSeed(event.target.value)} placeholder="Optional" />
                  </label>
                  <label>
                    <span>Nonce</span>
                    <input type="text" value={nonce} onChange={(event) => setNonce(event.target.value)} placeholder="Optional" />
                  </label>
                </div>
              ) : null}
            </section>

            <div className="button-row">
              <button className="primary-button" type="button" onClick={submitRound} disabled={isPredicting || isSaving}>
                {isSaving ? "Saving..." : "Save round"}
              </button>
            </div>
          </section>

          <section className="card ranking-card">
            <div className="section-heading">
              <h2>Live cell ranking</h2>
              <p>The lowest risk cells are at the top. This is calculated only from the selected mine count dataset.</p>
            </div>

            <div className="ranking-list">
              {prediction.rankedCells.slice(0, 10).map((cell) => (
                <article key={cell.cellIndex} className="ranking-row">
                  <div>
                    <strong>{cell.label}</strong>
                    <small>
                      Risk {percent(cell.riskScore)} | Confidence {percent(cell.confidence)}
                    </small>
                  </div>
                  <div className="ranking-metrics">
                    <span className="badge">Mine reports {cell.mineReports}</span>
                    <span className="badge">Played wins {percent(cell.playWinRate)}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {message ? <p className="success-text notice-banner success-banner">{message}</p> : null}
      {error ? <p className="error-text notice-banner error-banner">{error}</p> : null}
    </div>
  );
}
