import { useEffect, useRef, useState } from 'react';

const thumbCache = new Map();

function ImageIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
      <rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

/**
 * 48x48 preview thumbnail that lazily requests a data-URI from main when it
 * enters the viewport. Falls back to a type icon if ffmpeg generation fails
 * or while the request is in flight.
 */
export default function Thumbnail({ inputPath, detectedType }) {
  const [dataUri, setDataUri] = useState(() => thumbCache.get(inputPath) || null);
  const [visible, setVisible] = useState(false);
  const elementRef = useRef(null);

  useEffect(() => {
    if (!elementRef.current || visible) return undefined;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
          break;
        }
      }
    }, { rootMargin: '200px', threshold: 0.01 });

    observer.observe(elementRef.current);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || dataUri) return;

    let cancelled = false;

    (async () => {
      try {
        const result = await window.converter.getThumbnail(inputPath, detectedType);
        if (!cancelled && result?.ok && result.dataUri) {
          thumbCache.set(inputPath, result.dataUri);
          setDataUri(result.dataUri);
        }
      } catch {
        // Silently fall back to the icon.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, dataUri, inputPath, detectedType]);

  const Icon = detectedType === 'image' ? ImageIcon : VideoIcon;

  return (
    <div ref={elementRef} className="queue-row__icon queue-row__thumb">
      {dataUri ? (
        <img src={dataUri} alt="" draggable={false} />
      ) : (
        <Icon />
      )}
    </div>
  );
}
