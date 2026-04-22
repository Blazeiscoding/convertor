# Flux Converter

Flux Converter is an offline desktop app for converting local images and videos. It is built with Electron, React, Vite, and bundled FFmpeg binaries, so conversions run on the user's machine without any cloud upload or external service.

## Features

- Drag-and-drop or browse for local media files
- Convert both images and videos from a single queue
- Automatic media probing with FFprobe before queueing
- Thumbnail previews in the queue (lazy-loaded via `IntersectionObserver`)
- Per-file output format selection
- **Quality presets** (low / medium / high / lossless) for every image + video format
- **Resize controls** (percent scale, fit within a bound, exact dimensions) with optional aspect lock
- **Video rate-control modes**: quality preset, target bitrate, or target file size (two-pass)
- **Audio controls** for video outputs: keep, strip, or re-encode with a bitrate selector
- **Frame-rate override** for videos
- **Full trim/crop editor** with video preview, in/out markers, and a resizable crop rectangle
- **Global defaults** in Settings + optional **per-job overrides** right inside each queue row
- **Bulk apply bar** to set format, quality, or resize presets across all images / videos / pending jobs
- **Estimated output size** + real-time **conversion ETA**
- Default output folder and default format preferences
- Parallel job processing with configurable concurrency from 1 to 4
- Cancel, retry, remove, and clear conversion history
- Optional GPU-accelerated video encoding when compatible hardware is detected
- Packaged desktop builds for Windows, macOS, and Linux via Electron Builder

## Supported formats

### Input

Images:

- JPG / JPEG
- PNG
- WEBP
- AVIF
- GIF
- BMP
- TIF / TIFF

Videos:

- MP4
- WEBM
- MKV
- MOV
- AVI
- M4V
- MPG / MPEG

### Output

Images:

- JPG
- PNG
- WEBP
- AVIF
- GIF
- BMP
- TIFF

Videos:

- MP4
- WEBM
- MKV
- MOV
- AVI
- GIF

## Stack

- Electron for the desktop shell and native dialogs
- React 19 for the renderer UI
- Vite for renderer development and bundling
- Tailwind CSS v4 for styling
- `fluent-ffmpeg` with `ffmpeg-static` and `ffprobe-static` for local media processing
- `electron-store` for persisted app settings and recent-job history

## Project structure

```text
.
├── public/                  # Renderer HTML entry
├── scripts/                 # Dev launcher scripts
├── src/
│   ├── main/                # Electron main process, IPC, queue, conversion logic
│   ├── preload/             # Secure bridge exposed to the renderer
│   └── renderer/            # React UI
├── dist/                    # Built renderer output
├── release/                 # Electron Builder release artifacts
├── electron-builder.config.js
├── package.json
└── vite.config.js
```

## Development

### Prerequisites

- Node.js 20+ is the safe baseline for current Electron and Vite tooling
- npm
- Windows, macOS, or Linux

### Install dependencies

```bash
npm install
```

### Run in development

```bash
npm run dev
```

This starts:

- the Vite renderer on `http://localhost:5173/public/index.html`
- the Electron app pointed at that renderer URL

## Build and package

Build the renderer only:

```bash
npm run build:renderer
```

Create an unpacked Electron app directory:

```bash
npm run pack
```

Create installable distribution artifacts:

```bash
npm run dist
```

Packaging is configured for:

- Windows: NSIS installer
- macOS: DMG
- Linux: AppImage

Native installers still need to be built on their target operating systems.

## How it works

1. Files are selected from the UI through drag-and-drop or the system file picker.
2. The main process probes each file with FFprobe to determine whether it is a supported image or video.
3. Valid files are turned into queue jobs with an output format, target directory, and a resolved `JobOptions` (quality, resize, video rate-control, audio, trim, crop).
4. Per-job options are built from the global defaults stored in `electron-store` and optionally overridden per file from the queue row or the bulk-apply bar.
5. `src/main/encoderOptions.js` translates those options into codec-specific FFmpeg arguments for every image format and every CPU/GPU video encoder.
6. The job queue runs conversions using bundled FFmpeg binaries. Target-file-size mode triggers a two-pass flow that shares a passlog file and reports progress over the 0–50 / 50–100 range.
7. Progress, completion, cancellation, and failure events are sent back to the React UI over IPC; the renderer derives an ETA from elapsed time and percent while the job runs.
8. Thumbnails are generated on demand via a single FFmpeg frame extract, cached in an OS-temp directory keyed by `sha1(inputPath + mtime)`.
9. For the trim/crop editor, a custom `app://flux-media/` protocol registered in the main process streams the source file into an HTML `<video>` element so previews work without disabling `webSecurity`.
10. Completed and failed jobs are saved to persistent history through `electron-store`, including their resolved `JobOptions` so Retry reuses the same settings.

## GPU acceleration

Video conversions can use hardware acceleration when FFmpeg can successfully validate a supported encoder on the current machine.

The detection logic currently probes these encoder paths in order:

- NVIDIA NVENC
- AMD AMF
- Intel QSV
- Apple VideoToolbox on macOS
- Windows Media Foundation on Windows

If no working hardware encoder is detected, the app falls back to CPU codecs automatically.

## Persistence

The app stores:

- default output directory
- max parallel job count
- GPU on/off preference
- default image and video output formats
- default encoding options (`defaultOptions`: quality, resize, video rate-control, audio)
- recent conversion history (including the resolved options used per job)

If the app is closed while conversions are still running, those in-progress jobs are restored as cancelled entries on the next launch.

## Notes

- Conversion is fully local; files are not uploaded anywhere by the app itself.
- Image conversions always use CPU encoding.
- Video-to-GIF is supported as an output path.
- Output filenames are de-duplicated automatically to avoid overwriting existing files.
- Temporary conversion artifacts are cleaned from the selected output directory before queue execution.

## License

MIT
