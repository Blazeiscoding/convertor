import FormatPicker from './FormatPicker';
import JobRowDetails from './JobRowDetails';
import ProgressBar from './ProgressBar';
import Thumbnail from './Thumbnail';

function ChevronDown({ open }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function badgeStyle(status) {
  switch (status) {
    case 'ready':
      return { background: 'rgba(148, 163, 184, 0.12)', color: '#cbd5e1', border: '1px solid rgba(148, 163, 184, 0.18)' };
    case 'queued':
      return { background: 'rgba(234, 179, 8, 0.12)', color: '#facc15', border: '1px solid rgba(234, 179, 8, 0.18)' };
    case 'converting':
      return { background: 'rgba(56, 189, 248, 0.12)', color: '#7dd3fc', border: '1px solid rgba(56, 189, 248, 0.18)' };
    case 'done':
      return { background: 'rgba(34, 197, 94, 0.12)', color: '#86efac', border: '1px solid rgba(34, 197, 94, 0.18)' };
    case 'failed':
      return { background: 'rgba(239, 68, 68, 0.12)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.18)' };
    case 'cancelled':
      return { background: 'rgba(113, 113, 122, 0.14)', color: '#d4d4d8', border: '1px solid rgba(113, 113, 122, 0.2)' };
    default:
      return { background: 'rgba(113, 113, 122, 0.12)', color: '#d4d4d8', border: '1px solid rgba(113, 113, 122, 0.18)' };
  }
}

function formatStatus(status) {
  switch (status) {
    case 'pending-edit':
      return 'Ready';
    case 'queued':
      return 'Queued';
    case 'converting':
      return 'Converting';
    case 'done':
      return 'Done';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Ready';
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatMetadataLine(job) {
  const parts = [formatBytes(job.fileSize)];

  if (job.dimensions?.width && job.dimensions?.height) {
    parts.push(`${job.dimensions.width}×${job.dimensions.height}`);
  }

  if (job.detectedType === 'video' && job.hasAudio) {
    parts.push('audio');
  }

  return parts.join(' • ');
}

function renderSectionTitle(title, count) {
  return (
    <div className="mb-3 mt-5 flex items-center justify-between">
      <h3 className="text-xs font-semibold uppercase tracking-[0.24em]" style={{ color: 'var(--muted-foreground)' }}>
        {title}
      </h3>
      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
        {count}
      </span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card px-5 py-14 text-center">
      <div
        className="empty-icon mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl"
        style={{ background: 'rgba(148, 163, 184, 0.06)', border: '1px solid var(--border)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted-foreground)' }}>
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14,2 14,8 20,8" />
        </svg>
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>No files in the queue yet</p>
      <p className="mx-auto mt-1.5 max-w-xs text-xs leading-5" style={{ color: 'var(--muted-foreground)' }}>
        Add files above to start a conversion batch. Completed work will appear below as recent activity.
      </p>
    </div>
  );
}

function JobRow({
  job,
  isExpanded,
  formatOptions,
  defaultOptions,
  estimatedBytes,
  onToggleExpanded,
  onFormatChange,
  onOptionsChange,
  onOptionsClear,
  onRevealOutput,
  onCopyPath,
  onCancelJob,
  onRetryJob,
  onRemoveJob
}) {
  const rowKey = job.jobId || job.clientId;
  const uiStatus = job.status === 'pending-edit' ? 'ready' : job.status;
  const isEditable = !job.jobId && job.status === 'pending-edit';

  const actions = [];

  if (job.outputPath) {
    actions.push(
      <button key="reveal" type="button" className="queue-action" onClick={(event) => { event.stopPropagation(); onRevealOutput(job.outputPath); }}>
        Reveal
      </button>
    );
    actions.push(
      <button key="copy" type="button" className="queue-action" onClick={(event) => { event.stopPropagation(); onCopyPath(job.outputPath); }}>
        Copy path
      </button>
    );
  }

  if (job.jobId && (job.status === 'queued' || job.status === 'converting')) {
    actions.push(
      <button key="cancel" type="button" className="queue-action danger" onClick={(event) => { event.stopPropagation(); onCancelJob(job.jobId); }}>
        Cancel
      </button>
    );
  }

  if (job.jobId && (job.status === 'failed' || job.status === 'cancelled')) {
    actions.push(
      <button key="retry" type="button" className="queue-action" onClick={(event) => { event.stopPropagation(); onRetryJob(job); }}>
        Retry
      </button>
    );
  }

  if (job.status !== 'queued' && job.status !== 'converting') {
    actions.push(
      <button key="remove" type="button" className="queue-action" onClick={(event) => { event.stopPropagation(); onRemoveJob(job); }}>
        Remove
      </button>
    );
  }

  return (
    <article className={`queue-row ${isExpanded ? 'expanded' : ''}`}>
      <button type="button" className="queue-row__button" onClick={() => onToggleExpanded(rowKey)}>
        <div className="queue-row__grid">
          <div className="flex min-w-0 items-start gap-3">
            <Thumbnail inputPath={job.inputPath} detectedType={job.detectedType} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="truncate text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                  {job.fileName}
                </h4>
                <span className="queue-badge" style={badgeStyle(uiStatus)}>
                  {formatStatus(job.status)}
                </span>
                {job.optionsOverride ? (
                  <span
                    className="queue-badge"
                    title="Custom encoding options for this file"
                    style={{ background: 'rgba(125, 211, 252, 0.12)', color: '#7dd3fc', border: '1px solid rgba(125, 211, 252, 0.22)' }}
                  >
                    Custom
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {formatMetadataLine(job)}
              </p>
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em]" style={{ color: 'var(--muted-foreground)' }}>
              <span>Target</span>
              <span>{job.outputFormat.toUpperCase()}</span>
            </div>
            <FormatPicker
              value={job.outputFormat}
              options={formatOptions[job.detectedType]}
              onChange={(value) => onFormatChange(job.clientId, value)}
              disabled={!isEditable}
            />
          </div>

          <div className="min-w-0">
            <ProgressBar
              percent={job.percent}
              mode={job.progressMode}
              status={job.status}
              timemark={job.timemark}
              startedAt={job.startedAt}
            />
            {job.status === 'pending-edit' && Number.isFinite(estimatedBytes) && estimatedBytes > 0 ? (
              <p className="mt-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                ~{formatBytes(estimatedBytes)} estimated
              </p>
            ) : null}
            {job.errorMessage && !isExpanded ? (
              <p className="mt-2 truncate text-xs" style={{ color: '#fca5a5' }}>
                {job.errorMessage}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2">
            <div className="hidden flex-wrap justify-end gap-2 lg:flex">
              {actions}
            </div>
            <span className="queue-chevron">
              <ChevronDown open={isExpanded} />
            </span>
          </div>
        </div>
      </button>

      {isExpanded ? (
        <div className="queue-row__details">
          <JobRowDetails
            job={job}
            defaultOptions={defaultOptions}
            estimatedBytes={estimatedBytes}
            onRevealOutput={onRevealOutput}
            onCopyPath={onCopyPath}
            onOptionsChange={onOptionsChange}
            onOptionsClear={onOptionsClear}
            actions={actions}
          />
        </div>
      ) : null}
    </article>
  );
}

export default function JobList({
  activeJobs,
  recentJobs,
  expandedRows,
  formatOptions,
  defaultOptions,
  estimatedSizes = {},
  onToggleExpanded,
  onFormatChange,
  onOptionsChange,
  onOptionsClear,
  onRevealOutput,
  onCopyPath,
  onCancelJob,
  onRetryJob,
  onRemoveJob
}) {
  const hasVisibleJobs = activeJobs.length > 0 || recentJobs.length > 0;

  if (!hasVisibleJobs) {
    return <EmptyState />;
  }

  return (
    <div>
      {activeJobs.length > 0 ? renderSectionTitle('Active queue', activeJobs.length) : null}
      {activeJobs.length > 0 ? (
        <div className="space-y-2">
          {activeJobs.map((job) => (
            <JobRow
              key={job.jobId || job.clientId}
              job={job}
              isExpanded={expandedRows.has(job.jobId || job.clientId)}
              formatOptions={formatOptions}
              defaultOptions={defaultOptions}
              estimatedBytes={estimatedSizes[job.clientId]}
              onToggleExpanded={onToggleExpanded}
              onFormatChange={onFormatChange}
              onOptionsChange={onOptionsChange}
              onOptionsClear={onOptionsClear}
              onRevealOutput={onRevealOutput}
              onCopyPath={onCopyPath}
              onCancelJob={onCancelJob}
              onRetryJob={onRetryJob}
              onRemoveJob={onRemoveJob}
            />
          ))}
        </div>
      ) : null}

      {recentJobs.length > 0 ? renderSectionTitle('Recent activity', recentJobs.length) : null}
      {recentJobs.length > 0 ? (
        <div className="space-y-2">
          {recentJobs.map((job) => (
            <JobRow
              key={job.jobId || job.clientId}
              job={job}
              isExpanded={expandedRows.has(job.jobId || job.clientId)}
              formatOptions={formatOptions}
              defaultOptions={defaultOptions}
              estimatedBytes={estimatedSizes[job.clientId]}
              onToggleExpanded={onToggleExpanded}
              onFormatChange={onFormatChange}
              onOptionsChange={onOptionsChange}
              onOptionsClear={onOptionsClear}
              onRevealOutput={onRevealOutput}
              onCopyPath={onCopyPath}
              onCancelJob={onCancelJob}
              onRetryJob={onRetryJob}
              onRemoveJob={onRemoveJob}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
