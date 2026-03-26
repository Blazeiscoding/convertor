import { useRef, useState } from 'react';

const IMAGE_INPUT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff']);
const VIDEO_INPUT_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.mpg', '.mpeg']);

function detectTypeFromPath(inputPath) {
  const extension = inputPath.slice(inputPath.lastIndexOf('.')).toLowerCase();

  if (IMAGE_INPUT_EXTENSIONS.has(extension)) {
    return 'image';
  }

  if (VIDEO_INPUT_EXTENSIONS.has(extension)) {
    return 'video';
  }

  return null;
}

function normalizeDroppedFiles(fileList) {
  const acceptedFiles = [];
  const rejectedFiles = [];

  for (const file of Array.from(fileList)) {
    if (!file.path) {
      rejectedFiles.push(file.name || 'Unknown file');
      continue;
    }

    const detectedType = detectTypeFromPath(file.path);

    if (!detectedType) {
      rejectedFiles.push(file.name || file.path);
      continue;
    }

    acceptedFiles.push({
      inputPath: file.path,
      fileName: file.name,
      fileSize: file.size,
      detectedType
    });
  }

  return { acceptedFiles, rejectedFiles };
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

export default function DropZone({ hasJobs, onBrowse, onFilesSelected }) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  function handleDragEnter(event) {
    event.preventDefault();
    dragCounter.current += 1;
    setIsDragging(true);
  }

  function handleDragLeave(event) {
    event.preventDefault();
    dragCounter.current = Math.max(0, dragCounter.current - 1);

    if (dragCounter.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDragOver(event) {
    event.preventDefault();
  }

  async function handleDrop(event) {
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);

    const { acceptedFiles, rejectedFiles } = normalizeDroppedFiles(event.dataTransfer.files);

    if (acceptedFiles.length > 0) {
      await onFilesSelected(acceptedFiles);
    }

    if (rejectedFiles.length > 0) {
      await onFilesSelected(rejectedFiles.map((fileName) => ({
        inputPath: fileName,
        fileName,
        fileSize: 0,
        detectedType: null,
        isSupported: false
      })));
    }
  }

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={`drop-zone ${isDragging ? 'dragging' : ''}`}
    >
      <div className="drop-zone__badge">
        <UploadIcon />
      </div>
      <p className="text-[0.9rem] font-semibold" style={{ color: 'var(--foreground)', letterSpacing: '-0.01em' }}>
        {isDragging ? 'Drop files to add them' : 'Add files and convert locally'}
      </p>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5" style={{ color: 'var(--muted-foreground)' }}>
        Images and videos stay on your machine. Supports JPG, PNG, MP4, WebM, MKV, MOV and more.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <button type="button" onClick={onBrowse} className="primary-button">
          Browse files
        </button>
        <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          {!hasJobs ? 'or drag and drop' : 'or drop more files here'}
        </span>
      </div>
    </div>
  );
}
