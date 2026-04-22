import { useMemo } from 'react';

const QUALITY_PRESETS = [
  { id: 'low', label: 'Low', hint: 'Smallest files' },
  { id: 'medium', label: 'Medium', hint: 'Balanced (default)' },
  { id: 'high', label: 'High', hint: 'Best visual quality' },
  { id: 'lossless', label: 'Lossless', hint: 'No quality loss' }
];

const RESIZE_MODES = [
  { id: 'none', label: 'Original size' },
  { id: 'percent', label: 'Scale %' },
  { id: 'fit', label: 'Fit within...' },
  { id: 'exact', label: 'Exact dimensions' }
];

const RATE_CONTROL_MODES = [
  { id: 'quality', label: 'Quality preset' },
  { id: 'bitrate', label: 'Target bitrate' },
  { id: 'targetSize', label: 'Target file size' }
];

const AUDIO_MODES = [
  { id: 'keep', label: 'Keep source' },
  { id: 'reencode', label: 'Re-encode' },
  { id: 'strip', label: 'Remove audio' }
];

function Pills({ value, options, onChange, disabled = false }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => !disabled && onChange(opt.id)}
          className={`format-pill ${opt.id === value ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
          title={opt.hint}
          disabled={disabled}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function NumberField({ value, onChange, min, max, step = 1, placeholder, suffix, disabled = false }) {
  return (
    <div className="options-number-field">
      <input
        type="number"
        value={value ?? ''}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            onChange(undefined);
            return;
          }
          const num = Number(raw);
          if (Number.isFinite(num)) {
            onChange(num);
          }
        }}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
      />
      {suffix ? <span className="options-number-suffix">{suffix}</span> : null}
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <div className="options-section">
      <div className="options-section__head">
        <span className="settings-label">{title}</span>
        {description ? <span className="options-section__hint">{description}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Controlled panel for JobOptions (quality / resize / video).
 *
 * Props:
 *   value       -- current JobOptions
 *   onChange    -- (nextValue) => void
 *   mediaType   -- 'image' | 'video' | 'both' (drives which sections show)
 *   showTrimCrop -- show a placeholder "Edit clip..." slot (filled by parent)
 *   trimCropSlot -- optional ReactNode rendered in the trim/crop spot
 */
export default function OptionsPanel({
  value,
  onChange,
  mediaType = 'both',
  showTrimCrop = false,
  trimCropSlot = null
}) {
  const showVideo = mediaType === 'video' || mediaType === 'both';
  const showImage = mediaType === 'image' || mediaType === 'both';

  const resize = value.resize || { mode: 'none', keepAspect: true };
  const videoOptions = value.video || { rateControl: 'quality', audio: { mode: 'keep', bitrateKbps: 192 } };
  const audio = videoOptions.audio || { mode: 'keep', bitrateKbps: 192 };

  const update = (patch) => onChange({ ...value, ...patch });
  const updateResize = (patch) => update({ resize: { ...resize, ...patch } });
  const updateVideo = (patch) => update({ video: { ...videoOptions, ...patch } });
  const updateAudio = (patch) => updateVideo({ audio: { ...audio, ...patch } });

  const rateControlBody = useMemo(() => {
    switch (videoOptions.rateControl) {
      case 'bitrate':
        return (
          <div className="options-inline">
            <span className="options-inline__label">Video bitrate</span>
            <NumberField
              value={videoOptions.bitrateKbps}
              onChange={(next) => updateVideo({ bitrateKbps: next })}
              min={100}
              max={50000}
              step={100}
              placeholder="e.g. 4000"
              suffix="kbps"
            />
          </div>
        );
      case 'targetSize':
        return (
          <div className="options-inline">
            <span className="options-inline__label">Target file size</span>
            <NumberField
              value={videoOptions.targetSizeMb}
              onChange={(next) => updateVideo({ targetSizeMb: next })}
              min={1}
              max={8000}
              step={1}
              placeholder="e.g. 25"
              suffix="MB"
            />
            <span className="options-section__hint">Uses two-pass encoding (CPU) — takes ~2x as long.</span>
          </div>
        );
      default:
        return (
          <p className="options-section__hint">
            Uses the quality preset above. Lossless falls back to CPU encoding when GPU is enabled.
          </p>
        );
    }
  }, [videoOptions.rateControl, videoOptions.bitrateKbps, videoOptions.targetSizeMb]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="options-panel">
      <Section title="Quality preset" description="Applies to images and videos.">
        <Pills
          value={value.quality || 'medium'}
          options={QUALITY_PRESETS}
          onChange={(next) => update({ quality: next })}
        />
      </Section>

      {(showImage || showVideo) ? (
        <Section title="Resize" description="Keep original, scale %, fit within a bound, or exact dimensions.">
          <div className="options-inline">
            <select
              className="options-select"
              value={resize.mode}
              onChange={(event) => updateResize({ mode: event.target.value })}
            >
              {RESIZE_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>{mode.label}</option>
              ))}
            </select>

            {resize.mode === 'percent' ? (
              <NumberField
                value={resize.percent}
                onChange={(next) => updateResize({ percent: next })}
                min={1}
                max={400}
                step={5}
                placeholder="100"
                suffix="%"
              />
            ) : null}

            {resize.mode === 'fit' ? (
              <NumberField
                value={resize.maxDimension}
                onChange={(next) => updateResize({ maxDimension: next })}
                min={16}
                max={16384}
                step={16}
                placeholder="1920"
                suffix="px max"
              />
            ) : null}

            {resize.mode === 'exact' ? (
              <>
                <NumberField
                  value={resize.width}
                  onChange={(next) => updateResize({ width: next })}
                  min={16}
                  max={16384}
                  step={2}
                  placeholder="width"
                  suffix="w"
                />
                <NumberField
                  value={resize.height}
                  onChange={(next) => updateResize({ height: next })}
                  min={16}
                  max={16384}
                  step={2}
                  placeholder="height"
                  suffix="h"
                />
              </>
            ) : null}

            {resize.mode !== 'none' ? (
              <label className="options-checkbox">
                <input
                  type="checkbox"
                  checked={resize.keepAspect !== false}
                  onChange={(event) => updateResize({ keepAspect: event.target.checked })}
                />
                Keep aspect ratio
              </label>
            ) : null}
          </div>
        </Section>
      ) : null}

      {showVideo ? (
        <>
          <Section title="Video rate control" description="How ffmpeg should allocate bits to your video.">
            <Pills
              value={videoOptions.rateControl || 'quality'}
              options={RATE_CONTROL_MODES}
              onChange={(next) => updateVideo({ rateControl: next })}
            />
            <div className="options-section__body">{rateControlBody}</div>
          </Section>

          <Section title="Frame rate" description="Leave blank to keep the source fps.">
            <NumberField
              value={videoOptions.fps ?? undefined}
              onChange={(next) => updateVideo({ fps: next === undefined ? null : next })}
              min={1}
              max={240}
              step={1}
              placeholder="source"
              suffix="fps"
            />
          </Section>

          <Section title="Audio" description="How to handle the audio stream.">
            <div className="options-inline">
              <Pills
                value={audio.mode}
                options={AUDIO_MODES}
                onChange={(next) => updateAudio({ mode: next })}
              />
              {audio.mode === 'reencode' ? (
                <NumberField
                  value={audio.bitrateKbps}
                  onChange={(next) => updateAudio({ bitrateKbps: next })}
                  min={32}
                  max={512}
                  step={16}
                  placeholder="192"
                  suffix="kbps"
                />
              ) : null}
            </div>
          </Section>

          {showTrimCrop ? (
            <Section title="Trim / crop" description="Open the editor to set start/end and crop.">
              {trimCropSlot}
            </Section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
