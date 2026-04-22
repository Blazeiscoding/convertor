import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function buildMediaUrl(inputPath) {
  return `app://flux-media/${encodeURIComponent(inputPath)}`;
}

function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0:00.0';
  const totalSec = ms / 1000;
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function useDrag(onMove) {
  const stateRef = useRef(null);

  const onPointerDown = useCallback((event, payload = {}) => {
    event.preventDefault();
    event.stopPropagation();
    event.target.setPointerCapture?.(event.pointerId);
    stateRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, payload };
  }, []);

  useEffect(() => {
    function handleMove(event) {
      if (!stateRef.current || event.pointerId !== stateRef.current.pointerId) return;
      const { startX, startY, payload } = stateRef.current;
      onMove({
        dx: event.clientX - startX,
        dy: event.clientY - startY,
        clientX: event.clientX,
        clientY: event.clientY,
        payload,
      });
    }
    function handleUp(event) {
      if (!stateRef.current || event.pointerId !== stateRef.current.pointerId) return;
      stateRef.current = null;
    }
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [onMove]);

  return onPointerDown;
}

const RESIZE_HANDLES = [
  { id: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { id: 'n', cursor: 'ns-resize', x: 0.5, y: 0 },
  { id: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { id: 'e', cursor: 'ew-resize', x: 1, y: 0.5 },
  { id: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { id: 's', cursor: 'ns-resize', x: 0.5, y: 1 },
  { id: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
  { id: 'w', cursor: 'ew-resize', x: 0, y: 0.5 },
];

export default function TrimCropEditor({ open, job, initialTrim, initialCrop, onSave, onClose }) {
  const videoRef = useRef(null);
  const stageRef = useRef(null);
  const [duration, setDuration] = useState(job?.duration ? job.duration * 1000 : 0);
  const [currentMs, setCurrentMs] = useState(0);
  const [startMs, setStartMs] = useState(0);
  const [endMs, setEndMs] = useState(job?.duration ? job.duration * 1000 : 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cropEnabled, setCropEnabled] = useState(false);
  const [videoNatural, setVideoNatural] = useState({ width: job?.dimensions?.width || 0, height: job?.dimensions?.height || 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0, offsetX: 0, offsetY: 0 });
  const [crop, setCrop] = useState(null);
  const [aspectLock, setAspectLock] = useState(false);

  const mediaUrl = useMemo(() => (job ? buildMediaUrl(job.inputPath) : null), [job]);

  useEffect(() => {
    if (!open) return;
    const initialDurationMs = (job?.duration || 0) * 1000;
    setDuration(initialDurationMs);
    setStartMs(initialTrim?.startMs ?? 0);
    setEndMs(initialTrim?.endMs ?? initialDurationMs);
    setCurrentMs(initialTrim?.startMs ?? 0);
    if (initialCrop) {
      setCropEnabled(true);
      setCrop(initialCrop);
    } else {
      setCropEnabled(false);
      setCrop(null);
    }
  }, [open, job, initialTrim, initialCrop]);

  useEffect(() => {
    if (!open) return undefined;
    function recompute() {
      const video = videoRef.current;
      const stage = stageRef.current;
      if (!video || !stage || !videoNatural.width || !videoNatural.height) return;
      const stageRect = stage.getBoundingClientRect();
      const stageAspect = stageRect.width / stageRect.height;
      const videoAspect = videoNatural.width / videoNatural.height;
      let displayWidth = stageRect.width;
      let displayHeight = stageRect.height;
      if (videoAspect > stageAspect) {
        displayHeight = displayWidth / videoAspect;
      } else {
        displayWidth = displayHeight * videoAspect;
      }
      setStageSize({
        width: displayWidth,
        height: displayHeight,
        offsetX: (stageRect.width - displayWidth) / 2,
        offsetY: (stageRect.height - displayHeight) / 2,
      });
    }
    recompute();
    const resizeObserver = new ResizeObserver(recompute);
    if (stageRef.current) resizeObserver.observe(stageRef.current);
    return () => resizeObserver.disconnect();
  }, [open, videoNatural]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    function onMeta() {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        const ms = video.duration * 1000;
        setDuration(ms);
        setEndMs((prev) => (prev > 0 && prev <= ms ? prev : ms));
        setVideoNatural({ width: video.videoWidth, height: video.videoHeight });
      }
    }
    function onTime() {
      setCurrentMs(video.currentTime * 1000);
      if (video.currentTime * 1000 >= endMs && isPlaying) {
        video.pause();
        setIsPlaying(false);
      }
    }
    function onPlay() { setIsPlaying(true); }
    function onPause() { setIsPlaying(false); }

    video.addEventListener('loadedmetadata', onMeta);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('loadedmetadata', onMeta);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
  }, [endMs, isPlaying, mediaUrl]);

  const onTimelineDrag = useCallback(({ clientX, payload }) => {
    const timeline = payload.timelineRect;
    if (!timeline || duration <= 0) return;
    const relativeX = clamp(clientX - timeline.left, 0, timeline.width);
    const ms = (relativeX / timeline.width) * duration;

    if (payload.kind === 'scrub') {
      const target = clamp(ms, 0, duration);
      setCurrentMs(target);
      if (videoRef.current) videoRef.current.currentTime = target / 1000;
    } else if (payload.kind === 'start') {
      setStartMs(clamp(ms, 0, endMs - 250));
    } else if (payload.kind === 'end') {
      setEndMs(clamp(ms, startMs + 250, duration));
    }
  }, [duration, endMs, startMs]);

  const beginTimelineDrag = useDrag(onTimelineDrag);

  const cropPxToRatio = useCallback((pxRect) => {
    if (!videoNatural.width || !videoNatural.height) return null;
    const scaleX = videoNatural.width / stageSize.width;
    const scaleY = videoNatural.height / stageSize.height;
    return {
      x: Math.max(0, Math.round(pxRect.x * scaleX)),
      y: Math.max(0, Math.round(pxRect.y * scaleY)),
      width: Math.round(pxRect.width * scaleX),
      height: Math.round(pxRect.height * scaleY),
    };
  }, [stageSize, videoNatural]);

  const cropRatioToPx = useCallback((rect) => {
    if (!rect || !videoNatural.width || !videoNatural.height) return null;
    const scaleX = stageSize.width / videoNatural.width;
    const scaleY = stageSize.height / videoNatural.height;
    return {
      x: rect.x * scaleX,
      y: rect.y * scaleY,
      width: rect.width * scaleX,
      height: rect.height * scaleY,
    };
  }, [stageSize, videoNatural]);

  const cropPx = useMemo(() => cropRatioToPx(crop), [crop, cropRatioToPx]);

  const ensureCrop = useCallback(() => {
    if (crop || !videoNatural.width) return;
    setCrop({ x: 0, y: 0, width: videoNatural.width, height: videoNatural.height });
  }, [crop, videoNatural]);

  useEffect(() => { if (cropEnabled) ensureCrop(); }, [cropEnabled, ensureCrop]);

  const onCropDrag = useCallback(({ dx, dy, payload }) => {
    if (!cropPx || !stageSize.width) return;
    const originRect = payload.origin;
    const scaleX = videoNatural.width / stageSize.width;
    const scaleY = videoNatural.height / stageSize.height;
    const ddx = dx * scaleX;
    const ddy = dy * scaleY;

    setCrop((prev) => {
      if (!prev) return prev;
      let { x, y, width, height } = originRect;

      if (payload.kind === 'move') {
        x = clamp(x + ddx, 0, videoNatural.width - width);
        y = clamp(y + ddy, 0, videoNatural.height - height);
      } else {
        const handle = payload.kind;
        const ar = aspectLock ? originRect.width / originRect.height : null;
        if (handle.includes('w')) { x = clamp(x + ddx, 0, x + width - 16); width = originRect.x + originRect.width - x; }
        if (handle.includes('e')) { width = clamp(originRect.width + ddx, 16, videoNatural.width - x); }
        if (handle.includes('n')) { y = clamp(y + ddy, 0, y + height - 16); height = originRect.y + originRect.height - y; }
        if (handle.includes('s')) { height = clamp(originRect.height + ddy, 16, videoNatural.height - y); }
        if (ar) {
          if (handle === 'n' || handle === 's') { width = height * ar; x = clamp(x, 0, videoNatural.width - width); }
          else if (handle === 'e' || handle === 'w') { height = width / ar; y = clamp(y, 0, videoNatural.height - height); }
          else if (handle.length === 2) { height = width / ar; if (handle.includes('n')) { y = originRect.y + originRect.height - height; } }
        }
      }
      return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    });
  }, [aspectLock, cropPx, stageSize, videoNatural]);

  const beginCropDrag = useDrag(onCropDrag);

  const playPreview = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = startMs / 1000;
    video.play();
  }, [startMs]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play(); else video.pause();
  }, []);

  const handleSave = useCallback(() => {
    const trim = (startMs > 0 || endMs < duration) && duration > 0
      ? { startMs: Math.round(startMs), endMs: Math.round(endMs) }
      : null;

    const cropOut = cropEnabled && crop && (
      crop.x > 0 || crop.y > 0 ||
      crop.width < videoNatural.width || crop.height < videoNatural.height
    ) ? crop : null;

    onSave({ trim, crop: cropOut });
  }, [crop, cropEnabled, duration, endMs, onSave, startMs, videoNatural]);

  if (!open || !job) return null;

  const percentFor = (ms) => (duration > 0 ? (ms / duration) * 100 : 0);

  return (
    <div className="editor-backdrop" onClick={onClose}>
      <div className="editor-modal" onClick={(event) => event.stopPropagation()}>
        <div className="editor-header">
          <div>
            <h2 className="editor-title">Trim & crop</h2>
            <p className="editor-subtitle">{job.fileName}</p>
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        </div>

        <div className="editor-stage" ref={stageRef}>
          {mediaUrl ? (
            <video
              ref={videoRef}
              src={mediaUrl}
              className="editor-video"
              style={{
                width: stageSize.width || '100%',
                height: stageSize.height || '100%',
                left: stageSize.offsetX || 0,
                top: stageSize.offsetY || 0,
              }}
              preload="auto"
              muted
            />
          ) : null}

          {cropEnabled && cropPx && stageSize.width > 0 ? (
            <div
              className="editor-crop-overlay"
              style={{
                left: stageSize.offsetX,
                top: stageSize.offsetY,
                width: stageSize.width,
                height: stageSize.height,
              }}
            >
              <div
                className="editor-crop-rect"
                style={{
                  left: cropPx.x,
                  top: cropPx.y,
                  width: cropPx.width,
                  height: cropPx.height,
                }}
                onPointerDown={(event) => beginCropDrag(event, { kind: 'move', origin: crop })}
              >
                {RESIZE_HANDLES.map((h) => (
                  <div
                    key={h.id}
                    className="editor-crop-handle"
                    style={{
                      left: `${h.x * 100}%`,
                      top: `${h.y * 100}%`,
                      cursor: h.cursor,
                    }}
                    onPointerDown={(event) => beginCropDrag(event, { kind: h.id, origin: crop })}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="editor-timeline">
          <div
            className="editor-timeline-track"
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              beginTimelineDrag(event, { kind: 'scrub', timelineRect: rect });
            }}
          >
            <div
              className="editor-timeline-selection"
              style={{
                left: `${percentFor(startMs)}%`,
                width: `${Math.max(0, percentFor(endMs) - percentFor(startMs))}%`,
              }}
            />
            <div
              className="editor-timeline-marker start"
              style={{ left: `${percentFor(startMs)}%` }}
              onPointerDown={(event) => {
                const rect = event.currentTarget.parentElement.getBoundingClientRect();
                beginTimelineDrag(event, { kind: 'start', timelineRect: rect });
              }}
              title="Start"
            />
            <div
              className="editor-timeline-marker end"
              style={{ left: `${percentFor(endMs)}%` }}
              onPointerDown={(event) => {
                const rect = event.currentTarget.parentElement.getBoundingClientRect();
                beginTimelineDrag(event, { kind: 'end', timelineRect: rect });
              }}
              title="End"
            />
            <div
              className="editor-timeline-playhead"
              style={{ left: `${percentFor(currentMs)}%` }}
            />
          </div>
          <div className="editor-timeline-labels">
            <span>in {formatTime(startMs)}</span>
            <span>now {formatTime(currentMs)}</span>
            <span>out {formatTime(endMs)}</span>
          </div>
        </div>

        <div className="editor-controls">
          <button type="button" className="secondary-button" onClick={togglePlay}>
            {isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="secondary-button" onClick={playPreview}>
            Preview clip
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setStartMs(currentMs)}
            title="Set in point to playhead"
          >
            Set in = now
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setEndMs(currentMs)}
            title="Set out point to playhead"
          >
            Set out = now
          </button>

          <div className="editor-divider" />

          <label className="options-checkbox">
            <input
              type="checkbox"
              checked={cropEnabled}
              onChange={(event) => setCropEnabled(event.target.checked)}
            />
            Crop
          </label>
          <label className="options-checkbox" style={{ opacity: cropEnabled ? 1 : 0.4 }}>
            <input
              type="checkbox"
              disabled={!cropEnabled}
              checked={aspectLock}
              onChange={(event) => setAspectLock(event.target.checked)}
            />
            Lock aspect ratio
          </label>

          <div style={{ marginLeft: 'auto' }} />
          <button type="button" className="primary-button" onClick={handleSave}>
            Save clip
          </button>
        </div>
      </div>
    </div>
  );
}
