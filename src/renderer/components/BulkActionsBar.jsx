import { useState } from 'react';

const QUALITY_CHOICES = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'lossless', label: 'Lossless' }
];

const SCOPE_CHOICES = [
  { id: 'images', label: 'All images' },
  { id: 'videos', label: 'All videos' },
  { id: 'all', label: 'All pending' }
];

function ScopeBadge({ scope, counts }) {
  const count = scope === 'images' ? counts.images : scope === 'videos' ? counts.videos : counts.total;
  return (
    <span className="bulk-bar__count" title="Files matching the current scope">
      {count} file{count === 1 ? '' : 's'}
    </span>
  );
}

/**
 * Bulk actions bar: apply a format, a quality preset, or a resize preset to
 * all pending jobs matching the selected scope (images / videos / all).
 */
export default function BulkActionsBar({
  scope,
  onScopeChange,
  counts,
  formatOptions,
  onSetFormat,
  onSetQuality,
  onSetResize,
  onClearOverrides
}) {
  const [resizeMenuOpen, setResizeMenuOpen] = useState(false);

  const formats = scope === 'images'
    ? formatOptions.image
    : scope === 'videos'
      ? formatOptions.video
      : null;

  const totalMatching = scope === 'images'
    ? counts.images
    : scope === 'videos'
      ? counts.videos
      : counts.total;

  return (
    <div className="bulk-bar">
      <div className="bulk-bar__scope">
        <span className="bulk-bar__label">Apply to</span>
        <div className="flex gap-1">
          {SCOPE_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              className={`format-pill ${scope === choice.id ? 'active' : ''}`}
              onClick={() => onScopeChange(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <ScopeBadge scope={scope} counts={counts} />
      </div>

      <div className="bulk-bar__actions">
        {formats ? (
          <div className="bulk-bar__group">
            <span className="bulk-bar__label">Format</span>
            <select
              className="options-select"
              value=""
              onChange={(event) => {
                if (event.target.value) {
                  onSetFormat(scope, event.target.value);
                  event.target.value = '';
                }
              }}
              disabled={totalMatching === 0}
            >
              <option value="" disabled>Choose...</option>
              {formats.map((opt) => (
                <option key={opt} value={opt}>{opt.toUpperCase()}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="bulk-bar__group">
          <span className="bulk-bar__label">Quality</span>
          <div className="flex gap-1">
            {QUALITY_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className="format-pill"
                onClick={() => onSetQuality(scope, choice.id)}
                disabled={totalMatching === 0}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>

        <div className="bulk-bar__group">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setResizeMenuOpen((open) => !open)}
            disabled={totalMatching === 0}
          >
            Resize...
          </button>
          {resizeMenuOpen ? (
            <div className="bulk-bar__menu">
              <button
                type="button"
                className="bulk-bar__menu-item"
                onClick={() => {
                  onSetResize(scope, { mode: 'none' });
                  setResizeMenuOpen(false);
                }}
              >
                Keep original
              </button>
              <button
                type="button"
                className="bulk-bar__menu-item"
                onClick={() => {
                  onSetResize(scope, { mode: 'percent', percent: 50, keepAspect: true });
                  setResizeMenuOpen(false);
                }}
              >
                Scale 50%
              </button>
              <button
                type="button"
                className="bulk-bar__menu-item"
                onClick={() => {
                  onSetResize(scope, { mode: 'percent', percent: 75, keepAspect: true });
                  setResizeMenuOpen(false);
                }}
              >
                Scale 75%
              </button>
              <button
                type="button"
                className="bulk-bar__menu-item"
                onClick={() => {
                  onSetResize(scope, { mode: 'fit', maxDimension: 1920, keepAspect: true });
                  setResizeMenuOpen(false);
                }}
              >
                Fit within 1920px
              </button>
              <button
                type="button"
                className="bulk-bar__menu-item"
                onClick={() => {
                  onSetResize(scope, { mode: 'fit', maxDimension: 1280, keepAspect: true });
                  setResizeMenuOpen(false);
                }}
              >
                Fit within 1280px
              </button>
              <button
                type="button"
                className="bulk-bar__menu-item"
                onClick={() => {
                  onSetResize(scope, { mode: 'fit', maxDimension: 720, keepAspect: true });
                  setResizeMenuOpen(false);
                }}
              >
                Fit within 720px
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="subtle-danger-button"
          onClick={() => onClearOverrides(scope)}
          disabled={totalMatching === 0}
        >
          Clear overrides
        </button>
      </div>
    </div>
  );
}
