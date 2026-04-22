import { useState } from 'react';
import OptionsPanel from './OptionsPanel';
import TrimCropEditor from './TrimCropEditor';

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

function ChevronDown({ open }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export default function JobRowDetails({
  job,
  defaultOptions,
  estimatedBytes,
  onRevealOutput,
  onCopyPath,
  onOptionsChange,
  onOptionsClear,
  actions
}) {
  const isEditable = !job.jobId && job.status === 'pending-edit';
  const hasOverride = Boolean(job.optionsOverride);
  const [optionsOpen, setOptionsOpen] = useState(hasOverride);
  const [editorOpen, setEditorOpen] = useState(false);

  const effectiveOptions = job.optionsOverride || defaultOptions;
  const existingTrim = job.optionsOverride?.video?.trim || null;
  const existingCrop = job.optionsOverride?.video?.crop || null;

  const handleOptionsChange = (nextOptions) => {
    onOptionsChange?.(job.clientId, nextOptions);
    setOptionsOpen(true);
  };

  const handleClear = () => {
    onOptionsClear?.(job.clientId);
  };

  const handleEditorSave = ({ trim, crop }) => {
    const base = job.optionsOverride || defaultOptions;
    const nextVideo = { ...(base.video || {}), trim, crop };
    onOptionsChange?.(job.clientId, { ...base, video: nextVideo });
    setEditorOpen(false);
    setOptionsOpen(true);
  };

  return (
    <div className="space-y-4">
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
            {Number.isFinite(estimatedBytes) && estimatedBytes > 0 ? (
              <div className="details-pill">
                <span className="details-label">Est. size</span>
                <span className="details-value">~{formatBytes(estimatedBytes)}</span>
              </div>
            ) : null}
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

      {isEditable && onOptionsChange ? (
        <div className="job-override">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setOptionsOpen((open) => !open)}
              >
                <ChevronDown open={optionsOpen} />
                {hasOverride ? 'Custom encoding options' : 'Override encoding options'}
              </button>

              {job.detectedType === 'video' ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setEditorOpen(true)}
                >
                  {existingTrim || existingCrop ? 'Edit clip' : 'Trim / crop...'}
                </button>
              ) : null}
            </div>

            {hasOverride ? (
              <button type="button" className="subtle-danger-button" onClick={handleClear}>
                Reset to defaults
              </button>
            ) : null}
          </div>

          <TrimCropEditor
            open={editorOpen && job.detectedType === 'video'}
            job={job}
            initialTrim={existingTrim}
            initialCrop={existingCrop}
            onSave={handleEditorSave}
            onClose={() => setEditorOpen(false)}
          />

          {optionsOpen ? (
            <div className="job-override__panel">
              {!hasOverride ? (
                <p className="options-section__hint" style={{ marginBottom: '0.75rem' }}>
                  Changes here apply only to <strong>{job.fileName}</strong>. Start from the current global defaults.
                </p>
              ) : null}
              <OptionsPanel
                value={effectiveOptions}
                onChange={handleOptionsChange}
                mediaType={job.detectedType === 'image' ? 'image' : 'video'}
                showTrimCrop={false}
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
