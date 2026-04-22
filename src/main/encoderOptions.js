/**
 * Encoder option builder.
 *
 * Centralises every ffmpeg argument decision so converter.js only has to
 * orchestrate the process. Exposes helpers for quality presets, resize,
 * crop, fps, bitrate and two-pass target-size encoding. All consumers pass
 * a resolved `JobOptions` plus the probe result for the source file.
 *
 * @typedef {'low'|'medium'|'high'|'lossless'} QualityPreset
 *
 * @typedef {Object} ResizeOptions
 * @property {'none'|'percent'|'fit'|'exact'} mode
 * @property {number} [percent]        - 1..200, used when mode==='percent'
 * @property {number} [maxDimension]   - used when mode==='fit'
 * @property {number} [width]          - used when mode==='exact'
 * @property {number} [height]         - used when mode==='exact'
 * @property {boolean} [keepAspect]
 *
 * @typedef {Object} AudioOptions
 * @property {'keep'|'strip'|'reencode'} mode
 * @property {number} [bitrateKbps]
 *
 * @typedef {Object} TrimOptions
 * @property {number} startMs
 * @property {number} endMs
 *
 * @typedef {Object} CropOptions
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 *
 * @typedef {Object} VideoOptions
 * @property {'quality'|'bitrate'|'targetSize'} rateControl
 * @property {number} [bitrateKbps]
 * @property {number} [targetSizeMb]
 * @property {number|null} [fps]
 * @property {AudioOptions} audio
 * @property {TrimOptions|null} [trim]
 * @property {CropOptions|null} [crop]
 *
 * @typedef {Object} JobOptions
 * @property {QualityPreset} quality
 * @property {ResizeOptions} [resize]
 * @property {VideoOptions} [video]
 */

const path = require('node:path');

const QUALITY_PRESETS = ['low', 'medium', 'high', 'lossless'];

const DEFAULT_OPTIONS = Object.freeze({
  quality: 'medium',
  resize: Object.freeze({ mode: 'none', keepAspect: true }),
  video: Object.freeze({
    rateControl: 'quality',
    fps: null,
    audio: Object.freeze({ mode: 'keep', bitrateKbps: 192 }),
    trim: null,
    crop: null,
  }),
});

/**
 * Per-image-format quality tables.  Values mirror the previous hardcoded
 * defaults at the `medium` row so existing output quality stays identical.
 */
const IMAGE_QUALITY_ARGS = {
  jpg: {
    low: ['-q:v', '8'],
    medium: ['-q:v', '2'],
    high: ['-q:v', '2'],
    lossless: ['-q:v', '1'],
  },
  png: {
    low: ['-compression_level', '9'],
    medium: ['-compression_level', '6'],
    high: ['-compression_level', '3'],
    lossless: ['-compression_level', '6'],
  },
  webp: {
    low: ['-quality', '60'],
    medium: ['-quality', '90'],
    high: ['-quality', '95'],
    lossless: ['-lossless', '1', '-compression_level', '6'],
  },
  avif: {
    low: ['-crf', '40', '-cpu-used', '6'],
    medium: ['-crf', '28', '-cpu-used', '4'],
    high: ['-crf', '22', '-cpu-used', '4'],
    lossless: ['-crf', '0', '-cpu-used', '4'],
  },
  gif: {
    low: [],
    medium: [],
    high: [],
    lossless: [],
  },
  bmp: {
    low: [],
    medium: [],
    high: [],
    lossless: [],
  },
  tiff: {
    low: [],
    medium: [],
    high: [],
    lossless: [],
  },
};

/** Codec selection per output container (CPU path). */
const VIDEO_CPU_CODEC = {
  mp4: 'libx264',
  mkv: 'libx264',
  mov: 'libx264',
  webm: 'libvpx-vp9',
  avi: 'mpeg4',
};

/** Audio codec per container. */
const VIDEO_AUDIO_CODEC = {
  mp4: 'aac',
  mkv: 'aac',
  mov: 'aac',
  webm: 'libopus',
  avi: 'libmp3lame',
};

/**
 * Quality numbers per codec/vendor for each preset.
 * Values picked so `medium` matches today's behaviour.
 */
const VIDEO_QUALITY_TABLE = {
  libx264: { low: 28, medium: 23, high: 18, lossless: null },
  libx265: { low: 32, medium: 26, high: 20, lossless: null },
  'libvpx-vp9': { low: 36, medium: 31, high: 24, lossless: null },
  mpeg4: { low: 8, medium: 5, high: 2, lossless: 1 },
  h264_nvenc: { low: 28, medium: 23, high: 18, lossless: 0 },
  hevc_nvenc: { low: 32, medium: 26, high: 20, lossless: 0 },
  h264_qsv: { low: 28, medium: 23, high: 18, lossless: 1 },
  hevc_qsv: { low: 32, medium: 26, high: 20, lossless: 1 },
  h264_amf: { low: 30, medium: 23, high: 18, lossless: 0 },
  hevc_amf: { low: 34, medium: 26, high: 20, lossless: 0 },
  h264_videotoolbox: { low: 50, medium: 65, high: 80, lossless: 100 },
  hevc_videotoolbox: { low: 50, medium: 65, high: 80, lossless: 100 },
  h264_mf: { low: 55, medium: 75, high: 90, lossless: 100 },
};

function clamp(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.max(min, Math.min(max, numericValue));
}

function isValidQuality(value) {
  return QUALITY_PRESETS.includes(value);
}

/**
 * Merge user-supplied options onto defaults. Unknown or malformed fields
 * fall back silently so the rest of the pipeline can assume a sane shape.
 */
function resolveOptions(userOptions) {
  const base = userOptions && typeof userOptions === 'object' ? userOptions : {};
  const resize = base.resize && typeof base.resize === 'object' ? base.resize : {};
  const video = base.video && typeof base.video === 'object' ? base.video : {};
  const audio = video.audio && typeof video.audio === 'object' ? video.audio : {};

  return {
    quality: isValidQuality(base.quality) ? base.quality : DEFAULT_OPTIONS.quality,
    resize: {
      mode: ['none', 'percent', 'fit', 'exact'].includes(resize.mode) ? resize.mode : 'none',
      percent: Number.isFinite(resize.percent) ? clamp(resize.percent, 1, 400) : undefined,
      maxDimension: Number.isFinite(resize.maxDimension) ? clamp(resize.maxDimension, 16, 16384) : undefined,
      width: Number.isFinite(resize.width) ? clamp(resize.width, 16, 16384) : undefined,
      height: Number.isFinite(resize.height) ? clamp(resize.height, 16, 16384) : undefined,
      keepAspect: resize.keepAspect !== false,
    },
    video: {
      rateControl: ['quality', 'bitrate', 'targetSize'].includes(video.rateControl)
        ? video.rateControl
        : 'quality',
      bitrateKbps: Number.isFinite(video.bitrateKbps) ? clamp(video.bitrateKbps, 50, 200000) : undefined,
      targetSizeMb: Number.isFinite(video.targetSizeMb) ? clamp(video.targetSizeMb, 1, 100000) : undefined,
      fps: Number.isFinite(video.fps) ? clamp(video.fps, 1, 240) : null,
      audio: {
        mode: ['keep', 'strip', 'reencode'].includes(audio.mode) ? audio.mode : 'keep',
        bitrateKbps: Number.isFinite(audio.bitrateKbps) ? clamp(audio.bitrateKbps, 32, 512) : 192,
      },
      trim: video.trim && Number.isFinite(video.trim.startMs) && Number.isFinite(video.trim.endMs) &&
        video.trim.endMs > video.trim.startMs
        ? { startMs: Math.max(0, video.trim.startMs), endMs: video.trim.endMs }
        : null,
      crop: video.crop && Number.isFinite(video.crop.width) && Number.isFinite(video.crop.height) &&
        video.crop.width > 0 && video.crop.height > 0
        ? {
            x: Math.max(0, Math.trunc(video.crop.x || 0)),
            y: Math.max(0, Math.trunc(video.crop.y || 0)),
            width: Math.trunc(video.crop.width),
            height: Math.trunc(video.crop.height),
          }
        : null,
    },
  };
}

/**
 * Build the `-vf` filter chain for the requested resize / crop / fps.
 * Returns `null` when no filter is required so the caller can omit `-vf`.
 */
function buildFilterChain(options, probe, { forceEvenDims = false } = {}) {
  const filters = [];
  const crop = options?.video?.crop;
  const resize = options?.resize;

  if (crop) {
    filters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  }

  if (resize && resize.mode !== 'none') {
    const evenFlag = forceEvenDims ? ':force_divisible_by=2' : '';

    switch (resize.mode) {
      case 'percent': {
        const pct = resize.percent ?? 100;
        const wExpr = forceEvenDims ? `trunc(iw*${pct}/100/2)*2` : `iw*${pct}/100`;
        const hExpr = forceEvenDims ? `trunc(ih*${pct}/100/2)*2` : `ih*${pct}/100`;
        filters.push(`scale=${wExpr}:${hExpr}:flags=lanczos`);
        break;
      }
      case 'fit': {
        const maxDim = resize.maxDimension ?? 1920;
        filters.push(
          `scale=w=${maxDim}:h=${maxDim}:force_original_aspect_ratio=decrease${evenFlag}:flags=lanczos`
        );
        break;
      }
      case 'exact': {
        const width = resize.width ?? probe?.width ?? -2;
        const height = resize.height ?? probe?.height ?? -2;
        if (resize.keepAspect && resize.width && !resize.height) {
          filters.push(`scale=${width}:-2:flags=lanczos`);
        } else if (resize.keepAspect && !resize.width && resize.height) {
          filters.push(`scale=-2:${height}:flags=lanczos`);
        } else {
          filters.push(`scale=${width}:${height}:flags=lanczos`);
        }
        break;
      }
      default:
        break;
    }
  } else if (forceEvenDims) {
    filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }

  const fps = options?.video?.fps;
  if (fps && Number.isFinite(fps)) {
    filters.push(`fps=${fps}`);
  }

  return filters.length > 0 ? filters.join(',') : null;
}

/**
 * Build the flat `-flag value -flag value ...` array for an image output.
 * Consumers splice this directly into `command.outputOptions(...)`.
 */
function buildImageOutputArgs(format, options, probe) {
  const resolved = resolveOptions(options);
  const quality = resolved.quality;
  const qualityArgs = IMAGE_QUALITY_ARGS[format]?.[quality] ?? IMAGE_QUALITY_ARGS[format]?.medium ?? [];
  const filter = buildFilterChain(resolved, probe, { forceEvenDims: false });

  const codec = (() => {
    switch (format) {
      case 'jpg': return ['-c:v', 'mjpeg'];
      case 'png': return ['-c:v', 'png'];
      case 'webp': return ['-c:v', 'libwebp'];
      case 'avif': return ['-c:v', 'libaom-av1', '-still-picture', '1'];
      case 'gif': return ['-c:v', 'gif'];
      case 'bmp': return ['-c:v', 'bmp'];
      case 'tiff': return ['-c:v', 'tiff'];
      default: return [];
    }
  })();

  const args = [...codec, ...qualityArgs];

  if (filter) {
    args.push('-vf', filter);
  }

  args.push('-frames:v', '1');
  return args;
}

/**
 * Picks the effective video codec given target format, GPU availability and
 * whether the selected rate-control/quality preset forces CPU fallback.
 */
function selectVideoCodec(format, options, gpu) {
  const rateControl = options?.video?.rateControl || 'quality';
  const cpuCodec = VIDEO_CPU_CODEC[format];

  // WebM is always CPU: VP9 GPU paths are flaky/unsupported for most vendors.
  if (format === 'webm') return 'libvpx-vp9';
  // AVI is always CPU.
  if (format === 'avi') return 'mpeg4';
  // Two-pass target-size in GPU is messy. Fall back to CPU libx264/x265.
  if (rateControl === 'targetSize') return cpuCodec;
  // Lossless on GPU is unreliable for many encoders; fall back to CPU.
  if (options?.quality === 'lossless' && gpu?.available) {
    return cpuCodec;
  }

  if (gpu?.available && gpu?.vendor) {
    switch (gpu.vendor) {
      case 'nvidia': return 'h264_nvenc';
      case 'intel': return 'h264_qsv';
      case 'amd': return 'h264_amf';
      case 'apple': return 'h264_videotoolbox';
      case 'mediafoundation': return 'h264_mf';
      default: return cpuCodec;
    }
  }

  return cpuCodec;
}

/**
 * Returns the quality args for a given codec + preset, translated to the
 * appropriate rate-control flag.
 */
function buildQualityArgsForCodec(codec, quality) {
  const table = VIDEO_QUALITY_TABLE[codec];
  if (!table) return [];

  const value = table[quality];

  switch (codec) {
    case 'libx264':
    case 'libx265':
      if (quality === 'lossless') return ['-preset', 'medium', '-qp', '0'];
      return ['-preset', 'medium', '-crf', String(value)];
    case 'libvpx-vp9':
      if (quality === 'lossless') return ['-lossless', '1', '-b:v', '0'];
      return ['-crf', String(value), '-b:v', '0', '-row-mt', '1'];
    case 'mpeg4':
      return ['-q:v', String(value)];
    case 'h264_nvenc':
    case 'hevc_nvenc':
      if (quality === 'lossless') return ['-preset', 'p4', '-tune', 'lossless'];
      return ['-preset', 'p4', '-rc', 'vbr', '-cq', String(value)];
    case 'h264_qsv':
    case 'hevc_qsv':
      return ['-preset', 'medium', '-global_quality', String(value)];
    case 'h264_amf':
    case 'hevc_amf':
      return ['-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(value), '-qp_p', String(value), '-qp_b', String(value)];
    case 'h264_videotoolbox':
    case 'hevc_videotoolbox':
      return ['-q:v', String(value)];
    case 'h264_mf':
      return ['-rate_control', 'quality', '-quality', String(value)];
    default:
      return [];
  }
}

/**
 * Convert a bitrate request into the codec-specific rate-control flags.
 */
function buildBitrateArgsForCodec(codec, bitrateKbps) {
  const bitrate = `${Math.round(bitrateKbps)}k`;
  switch (codec) {
    case 'libx264':
    case 'libx265':
      return ['-preset', 'medium', '-b:v', bitrate, '-maxrate', bitrate, '-bufsize', `${Math.round(bitrateKbps * 2)}k`];
    case 'libvpx-vp9':
      return ['-b:v', bitrate, '-row-mt', '1'];
    case 'mpeg4':
      return ['-b:v', bitrate];
    case 'h264_nvenc':
    case 'hevc_nvenc':
      return ['-preset', 'p4', '-rc', 'vbr', '-b:v', bitrate, '-maxrate', bitrate];
    case 'h264_qsv':
    case 'hevc_qsv':
      return ['-preset', 'medium', '-b:v', bitrate];
    case 'h264_amf':
    case 'hevc_amf':
      return ['-quality', 'balanced', '-rc', 'vbr_latency', '-b:v', bitrate];
    case 'h264_videotoolbox':
    case 'hevc_videotoolbox':
      return ['-b:v', bitrate];
    case 'h264_mf':
      return ['-rate_control', 'cbr', '-b:v', bitrate];
    default:
      return ['-b:v', bitrate];
  }
}

/**
 * Derive a target video bitrate (kbps) from a requested file-size MB target.
 * Subtracts the audio bitrate share so the muxed output lands near the goal.
 */
function computeTargetBitrateKbps(targetSizeMb, durationSec, audioBitrateKbps) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  const totalKbits = targetSizeMb * 1024 * 8;
  const audioKbits = audioBitrateKbps * durationSec;
  const videoKbps = (totalKbits - audioKbits) / durationSec;
  return videoKbps > 100 ? Math.round(videoKbps) : 100;
}

function buildAudioArgs(format, options) {
  const audio = options?.video?.audio;
  if (!audio || audio.mode === 'keep') {
    return ['-c:a', 'copy'];
  }
  if (audio.mode === 'strip') {
    return ['-an'];
  }
  const codec = VIDEO_AUDIO_CODEC[format] || 'aac';
  return ['-c:a', codec, '-b:a', `${audio.bitrateKbps}k`];
}

function buildPixFmtArgs(codec) {
  if (codec === 'mpeg4') return [];
  if (codec.includes('qsv')) return ['-pix_fmt', 'nv12'];
  if (codec === 'h264_mf') return ['-pix_fmt', 'nv12'];
  return ['-pix_fmt', 'yuv420p'];
}

function buildContainerArgs(format) {
  if (format === 'mp4' || format === 'mov') return ['-movflags', '+faststart'];
  return [];
}

/**
 * Build the trim-related flags split into input-side (fast seek) and
 * output-side (accurate duration) portions.
 */
function buildTrimArgs(options) {
  const trim = options?.video?.trim;
  if (!trim) return { inputOptions: [], outputOptions: [] };

  const startSec = trim.startMs / 1000;
  const durationSec = (trim.endMs - trim.startMs) / 1000;

  return {
    inputOptions: startSec > 0 ? ['-ss', startSec.toFixed(3)] : [],
    outputOptions: durationSec > 0 ? ['-t', durationSec.toFixed(3)] : [],
  };
}

/**
 * Build the full arg set for a video output.
 *
 * Returns:
 *   { inputOptions, outputOptions, needsTwoPass, pass1OutputOptions,
 *     pass2OutputOptions, passlogPrefix }
 *
 * When `needsTwoPass` is true, callers must run ffmpeg twice sharing the
 * `passlogPrefix` path. For single-pass encoding, `outputOptions` alone is
 * sufficient.
 */
function buildVideoOutputArgs(format, options, probe, gpu) {
  const resolved = resolveOptions(options);
  const codec = selectVideoCodec(format, resolved, gpu);
  const audioArgs = buildAudioArgs(format, resolved);
  const containerArgs = buildContainerArgs(format);
  const pixFmtArgs = buildPixFmtArgs(codec);
  const trimArgs = buildTrimArgs(resolved);
  const filter = buildFilterChain(resolved, probe, { forceEvenDims: true });

  const filterArgs = filter ? ['-vf', filter] : [];

  const rateControl = resolved.video.rateControl;

  if (rateControl === 'bitrate' && resolved.video.bitrateKbps) {
    const rateArgs = buildBitrateArgsForCodec(codec, resolved.video.bitrateKbps);
    return {
      codec,
      inputOptions: trimArgs.inputOptions,
      outputOptions: [
        '-c:v', codec,
        ...rateArgs,
        ...pixFmtArgs,
        ...filterArgs,
        ...audioArgs,
        ...containerArgs,
        ...trimArgs.outputOptions,
      ],
      needsTwoPass: false,
    };
  }

  if (rateControl === 'targetSize' && resolved.video.targetSizeMb && probe?.duration) {
    const audioBitrate = resolved.video.audio.mode === 'strip'
      ? 0
      : (resolved.video.audio.bitrateKbps || 192);
    const effectiveDuration = resolved.video.trim
      ? (resolved.video.trim.endMs - resolved.video.trim.startMs) / 1000
      : probe.duration;
    const videoKbps = computeTargetBitrateKbps(
      resolved.video.targetSizeMb,
      effectiveDuration,
      audioBitrate
    );

    if (!videoKbps) {
      // Duration unknown — fall back to single-pass bitrate using a guess.
      const rateArgs = buildBitrateArgsForCodec(codec, 4000);
      return {
        codec,
        inputOptions: trimArgs.inputOptions,
        outputOptions: [
          '-c:v', codec,
          ...rateArgs,
          ...pixFmtArgs,
          ...filterArgs,
          ...audioArgs,
          ...containerArgs,
          ...trimArgs.outputOptions,
        ],
        needsTwoPass: false,
      };
    }

    // Two-pass is only implemented on CPU codecs (where it's well supported).
    const cpuCodec = VIDEO_CPU_CODEC[format] || 'libx264';
    const passlogPrefix = `.ffmpeg2pass-${Date.now()}`;
    const bitrateFlag = `${videoKbps}k`;

    return {
      codec: cpuCodec,
      inputOptions: trimArgs.inputOptions,
      needsTwoPass: true,
      passlogPrefix,
      pass1OutputOptions: [
        '-c:v', cpuCodec,
        '-preset', 'medium',
        '-b:v', bitrateFlag,
        '-pass', '1',
        '-passlogfile', passlogPrefix,
        ...pixFmtArgs,
        ...filterArgs,
        '-an',
        '-f', 'null',
        ...trimArgs.outputOptions,
      ],
      pass2OutputOptions: [
        '-c:v', cpuCodec,
        '-preset', 'medium',
        '-b:v', bitrateFlag,
        '-pass', '2',
        '-passlogfile', passlogPrefix,
        ...pixFmtArgs,
        ...filterArgs,
        ...audioArgs,
        ...containerArgs,
        ...trimArgs.outputOptions,
      ],
    };
  }

  // Default: quality-based (single-pass).
  const qualityArgs = buildQualityArgsForCodec(codec, resolved.quality);
  return {
    codec,
    inputOptions: trimArgs.inputOptions,
    outputOptions: [
      '-c:v', codec,
      ...qualityArgs,
      ...pixFmtArgs,
      ...filterArgs,
      ...audioArgs,
      ...containerArgs,
      ...trimArgs.outputOptions,
    ],
    needsTwoPass: false,
  };
}

/**
 * GIF output with the existing palette pipeline, now honouring a user-chosen
 * frame rate + resize + crop when present.
 */
function buildGifVideoOutputArgs(options, probe) {
  const resolved = resolveOptions(options);
  const fps = resolved.video?.fps || 12;
  const crop = resolved.video?.crop;
  const resize = resolved.resize;
  const trimArgs = buildTrimArgs(resolved);

  const preFilters = [];
  if (crop) preFilters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  if (resize?.mode === 'percent' && resize.percent) {
    preFilters.push(`scale=iw*${resize.percent}/100:-1:flags=lanczos`);
  } else if (resize?.mode === 'fit' && resize.maxDimension) {
    preFilters.push(`scale=w=${resize.maxDimension}:h=${resize.maxDimension}:force_original_aspect_ratio=decrease:flags=lanczos`);
  } else if (resize?.mode === 'exact') {
    preFilters.push(`scale=${resize.width ?? 'iw'}:${resize.height ?? '-1'}:flags=lanczos`);
  } else {
    preFilters.push('scale=iw:-1:flags=lanczos');
  }
  preFilters.unshift(`fps=${fps}`);

  const filter = `${preFilters.join(',')},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;

  return {
    codec: 'gif',
    inputOptions: trimArgs.inputOptions,
    outputOptions: [
      '-vf', filter,
      '-an',
      ...trimArgs.outputOptions,
    ],
    needsTwoPass: false,
  };
}

/**
 * Estimate output file size (bytes) given a probe and resolved options.
 * Intentionally coarse — it's only used for the UI's "Estimated size" hint.
 */
function estimateOutputSize(probe, options, format) {
  const resolved = resolveOptions(options);
  const pixelArea = (probe?.width || 1280) * (probe?.height || 720);

  if (probe?.detectedType === 'image' || ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff'].includes(format)) {
    const bitsPerPixel = {
      jpg: { low: 0.6, medium: 1.4, high: 2.2, lossless: 4.0 },
      png: { low: 4.0, medium: 4.0, high: 4.0, lossless: 4.0 },
      webp: { low: 0.4, medium: 0.9, high: 1.4, lossless: 3.5 },
      avif: { low: 0.15, medium: 0.35, high: 0.6, lossless: 3.5 },
      gif: { low: 2.0, medium: 2.0, high: 2.0, lossless: 2.0 },
      bmp: { low: 24, medium: 24, high: 24, lossless: 24 },
      tiff: { low: 24, medium: 24, high: 24, lossless: 24 },
    }[format] || { medium: 1 };

    const bpp = bitsPerPixel[resolved.quality] || bitsPerPixel.medium;
    const effectiveArea = applyResizeToArea(pixelArea, resolved.resize, probe);
    return Math.round((effectiveArea * bpp) / 8);
  }

  const durationSec = resolved.video?.trim
    ? (resolved.video.trim.endMs - resolved.video.trim.startMs) / 1000
    : (probe?.duration || 0);

  if (!durationSec) return null;

  let videoKbps;
  if (resolved.video.rateControl === 'bitrate' && resolved.video.bitrateKbps) {
    videoKbps = resolved.video.bitrateKbps;
  } else if (resolved.video.rateControl === 'targetSize' && resolved.video.targetSizeMb) {
    return Math.round(resolved.video.targetSizeMb * 1024 * 1024);
  } else {
    const bppTable = {
      mp4: { low: 0.05, medium: 0.1, high: 0.18, lossless: 1.5 },
      mkv: { low: 0.05, medium: 0.1, high: 0.18, lossless: 1.5 },
      mov: { low: 0.05, medium: 0.1, high: 0.18, lossless: 1.5 },
      webm: { low: 0.04, medium: 0.08, high: 0.14, lossless: 1.2 },
      avi: { low: 0.2, medium: 0.4, high: 0.8, lossless: 1.5 },
    }[format] || { medium: 0.1 };
    const bpp = bppTable[resolved.quality] || bppTable.medium;
    const fps = resolved.video?.fps || 30;
    videoKbps = (pixelArea * bpp * fps) / 1000;
  }

  const audioKbps = resolved.video.audio.mode === 'strip' ? 0 : (resolved.video.audio.bitrateKbps || 192);
  const totalKbits = (videoKbps + audioKbps) * durationSec;
  return Math.round((totalKbits * 1000) / 8);
}

function applyResizeToArea(originalArea, resize, probe) {
  if (!resize || resize.mode === 'none') return originalArea;
  const w = probe?.width;
  const h = probe?.height;
  if (!w || !h) return originalArea;
  switch (resize.mode) {
    case 'percent': {
      const pct = (resize.percent || 100) / 100;
      return originalArea * pct * pct;
    }
    case 'fit': {
      const maxDim = resize.maxDimension || 1920;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      return originalArea * scale * scale;
    }
    case 'exact': {
      const newW = resize.width || w;
      const newH = resize.height || h;
      return newW * newH;
    }
    default:
      return originalArea;
  }
}

module.exports = {
  DEFAULT_OPTIONS,
  QUALITY_PRESETS,
  resolveOptions,
  buildImageOutputArgs,
  buildVideoOutputArgs,
  buildGifVideoOutputArgs,
  buildFilterChain,
  computeTargetBitrateKbps,
  estimateOutputSize,
  selectVideoCodec,
};
