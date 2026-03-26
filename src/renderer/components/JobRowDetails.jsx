function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 'Unknown';
  }

  const totalSeconds = Math.round(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export default function JobRowDetails({ job, onRevealOutput, onCopyPath, actions }) {
  return (
    <div className="grid gap-4 text-sm lg:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-3">
        <div>
          <p className="details-label">Source file</p>
          <p className="details-value break-all">{job.inputPath}</p>
        </div>

        <div>
          <p className="details-label">Output location</p>
          <p className="details-value break-all">{job.outputPath || job.outputDir || 'Same as source folder'}</p>
        </div>

        {job.errorMessage ? (
          <div>
            <p className="details-label">Issue</p>
            <p className="details-error">{job.errorMessage}</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-3">
        <div className="details-grid">
          <div className="details-pill">
            <span className="details-label">Type</span>
            <span className="details-value">{job.detectedType}</span>
          </div>
          <div className="details-pill">
            <span className="details-label">Duration</span>
            <span className="details-value">{formatDuration(job.duration)}</span>
          </div>
          <div className="details-pill">
            <span className="details-label">Dimensions</span>
            <span className="details-value">
              {job.dimensions?.width && job.dimensions?.height ? `${job.dimensions.width}×${job.dimensions.height}` : 'Unknown'}
            </span>
          </div>
          <div className="details-pill">
            <span className="details-label">Audio</span>
            <span className="details-value">{job.hasAudio ? 'Yes' : 'No'}</span>
          </div>
        </div>

        {job.outputPath ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="queue-action" onClick={() => onRevealOutput(job.outputPath)}>
              Reveal output
            </button>
            <button type="button" className="queue-action" onClick={() => onCopyPath(job.outputPath)}>
              Copy path
            </button>
          </div>
        ) : null}

        {actions?.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 lg:hidden">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
