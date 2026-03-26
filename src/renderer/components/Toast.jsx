import { useEffect, useState } from 'react';

function paletteForType(type) {
  switch (type) {
    case 'error':
      return {
        background: 'rgba(239, 68, 68, 0.12)',
        color: '#fca5a5',
        icon: '!'
      };
    case 'warning':
      return {
        background: 'rgba(234, 179, 8, 0.12)',
        color: '#facc15',
        icon: '•'
      };
    default:
      return {
        background: 'rgba(34, 197, 94, 0.12)',
        color: '#86efac',
        icon: '✓'
      };
  }
}

export default function Toast({ type, message, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const palette = paletteForType(type);

  useEffect(() => {
    const timeoutId = setTimeout(() => setExiting(true), 3200);
    return () => clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    if (!exiting) {
      return undefined;
    }

    const timeoutId = setTimeout(onDismiss, 180);
    return () => clearTimeout(timeoutId);
  }, [exiting, onDismiss]);

  return (
    <div className={`${exiting ? 'animate-toast-exit' : 'animate-toast-enter'} toast-card`}>
      <span
        className="mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
        style={{
          background: palette.background,
          color: palette.color
        }}
      >
        {palette.icon}
      </span>
      <p className="flex-1 text-[13px] leading-relaxed" style={{ color: 'var(--foreground)' }}>
        {message}
      </p>
      <button type="button" className="toast-dismiss" onClick={() => setExiting(true)}>
        ×
      </button>
    </div>
  );
}
