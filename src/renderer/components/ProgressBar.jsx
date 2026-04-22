import { useEffect, useState } from 'react';

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remaining}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function useTicker(active, intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}

export default function ProgressBar({ percent, mode = 'determinate', status, timemark, startedAt }) {
  const normalizedPercent = typeof percent === 'number'
    ? Math.max(0, Math.min(100, percent))
    : 0;

  const isConverting = status === 'converting';
  useTicker(isConverting && startedAt);

  const isIndeterminate = mode === 'indeterminate' && isConverting;

  let etaLabel = null;
  if (isConverting && startedAt && normalizedPercent > 1 && normalizedPercent < 99) {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const totalSec = elapsedSec * (100 / normalizedPercent);
    const etaSec = Math.max(0, totalSec - elapsedSec);
    etaLabel = formatEta(etaSec);
  }

  const label = status === 'done'
    ? 'Done'
    : status === 'queued'
      ? 'Queued'
      : status === 'cancelled'
        ? 'Cancelled'
        : status === 'failed'
          ? 'Failed'
          : isIndeterminate
            ? (timemark || 'Working...')
            : `${Math.round(normalizedPercent)}%`;

  return (
    <div className="flex items-center gap-3">
      <div className="progress-track">
        {isIndeterminate ? (
          <div className="progress-indeterminate" />
        ) : (
          <div
            className="progress-fill"
            style={{
              width: `${status === 'done' ? 100 : normalizedPercent}%`,
              background: status === 'done' ? 'var(--success)' : 'var(--foreground)'
            }}
          />
        )}
      </div>
      <span className="progress-label">
        {label}
      </span>
      {etaLabel ? (
        <span className="progress-eta" title="Estimated time remaining">
          ~{etaLabel}
        </span>
      ) : null}
    </div>
  );
}
