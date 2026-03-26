export default function ProgressBar({ percent, mode = 'determinate', status, timemark }) {
  const normalizedPercent = typeof percent === 'number'
    ? Math.max(0, Math.min(100, percent))
    : 0;

  const isIndeterminate = mode === 'indeterminate' && status === 'converting';
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
    </div>
  );
}
