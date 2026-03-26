function FilterButton({ active, children, onClick, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="queue-filter"
      style={{
        background: active ? 'var(--foreground)' : 'transparent',
        color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
        borderColor: active ? 'transparent' : undefined
      }}
    >
      {children}
      {typeof count === 'number' && count > 0 ? (
        <span
          style={{
            marginLeft: '0.3rem',
            opacity: active ? 0.7 : 0.5,
          }}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

function ActionButton({ onClick, children, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="queue-bulk-action"
    >
      {children}
    </button>
  );
}

export default function QueueToolbar({
  scope,
  onScopeChange,
  readyCount,
  recentCount,
  failedCount,
  onClearFinished,
  onRetryFailed,
  onRemovePending,
  onClearHistory
}) {
  return (
    <div className="queue-toolbar">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterButton active={scope === 'all'} onClick={() => onScopeChange('all')}>All</FilterButton>
        <FilterButton active={scope === 'active'} onClick={() => onScopeChange('active')} count={readyCount}>Active</FilterButton>
        <FilterButton active={scope === 'recent'} onClick={() => onScopeChange('recent')} count={recentCount}>Recent</FilterButton>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {readyCount > 0 && (
          <ActionButton onClick={onRemovePending}>Clear pending</ActionButton>
        )}
        {failedCount > 0 && (
          <ActionButton onClick={onRetryFailed}>Retry failed</ActionButton>
        )}
        {recentCount > 0 && (
          <ActionButton onClick={onClearHistory}>Clear history</ActionButton>
        )}
      </div>
    </div>
  );
}
