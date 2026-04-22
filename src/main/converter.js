const fs = require('node:fs/promises');
const path = require('node:path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const {
  detectHardwareAcceleration,
  getCapabilities,
} = require('./gpu');
const {
  buildImageOutputArgs,
  buildVideoOutputArgs,
  buildGifVideoOutputArgs,
  resolveOptions,
} = require('./encoderOptions');

const TEMP_PREFIX = '.my-converter-temp-';
const PASSLOG_PREFIX = '.my-converter-passlog-';
const IMAGE_INPUT_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff']);
const VIDEO_INPUT_EXTENSIONS = new Set(['.mp4', '.webm', '.mkv', '.mov', '.avi', '.m4v', '.mpg', '.mpeg']);
const activeConversions = new Map();
const reservedOutputPaths = new Set();

function resolveBinaryPath(binaryPath) {
  if (!binaryPath) {
    return null;
  }

  return binaryPath.replace('app.asar', 'app.asar.unpacked');
}

const ffmpegPath = resolveBinaryPath(ffmpegStatic);
const ffprobePath = resolveBinaryPath(ffprobeStatic?.path || ffprobeStatic);

if (!ffmpegPath) {
  throw new Error('ffmpeg-static did not resolve an FFmpeg binary path.');
}

ffmpeg.setFfmpegPath(ffmpegPath);

if (ffprobePath) {
  ffmpeg.setFfprobePath(ffprobePath);
}

function parseTimemarkToSeconds(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const match = value.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);

  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds] = match;
  return (Number(hours) * 3600) + (Number(minutes) * 60) + Number(seconds);
}

function normalizeDuration(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function summarizeErrorMessage(message) {
  if (!message) {
    return 'Conversion failed.';
  }

  if (/no such file|cannot find/i.test(message)) {
    return 'The source file could not be found.';
  }

  if (/invalid data found/i.test(message)) {
    return 'The file could not be decoded.';
  }

  if (/permission denied/i.test(message)) {
    return 'The app could not write to the selected folder.';
  }

  if (/unknown encoder|muxer/i.test(message)) {
    return 'This output format is not supported by the bundled FFmpeg build.';
  }

  return message;
}

function getOutputExtension(format) {
  if (format === 'jpg') {
    return '.jpg';
  }

  if (format === 'tiff') {
    return '.tiff';
  }

  return `.${format}`;
}

async function fileExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function cleanupDirectoryArtifacts(outputDir) {
  try {
    const entries = await fs.readdir(outputDir);
    const leftovers = entries.filter(
      (entry) => entry.startsWith(TEMP_PREFIX) || entry.startsWith(PASSLOG_PREFIX)
    );
    const activeTempPaths = new Set(
      Array.from(activeConversions.values())
        .flatMap((item) => [item.tempOutputPath, item.passlogPrefix].filter(Boolean))
    );

    await Promise.all(leftovers.map(async (entry) => {
      const targetPath = path.join(outputDir, entry);

      if (activeTempPaths.has(targetPath)) {
        return;
      }

      await fs.rm(targetPath, { force: true });
    }));
  } catch (error) {
    console.warn('Failed to clean temporary artifacts:', error);
  }
}

async function resolveFinalOutputPath(job) {
  const extension = getOutputExtension(job.outputFormat);
  const baseName = path.basename(job.inputPath, path.extname(job.inputPath));
  let candidatePath = path.join(job.outputDir, `${baseName}${extension}`);
  let suffix = 1;

  while (reservedOutputPaths.has(candidatePath) || await fileExists(candidatePath)) {
    candidatePath = path.join(job.outputDir, `${baseName} (${suffix})${extension}`);
    suffix += 1;
  }

  reservedOutputPaths.add(candidatePath);
  return candidatePath;
}

function buildTempOutputPath(job, finalOutputPath) {
  const extension = path.extname(finalOutputPath);
  return path.join(job.outputDir, `${TEMP_PREFIX}${job.jobId}${extension}`);
}

function buildPasslogPath(job) {
  return path.join(job.outputDir, `${PASSLOG_PREFIX}${job.jobId}`);
}

async function safelyRemove(targetPath) {
  if (!targetPath) {
    return;
  }

  try {
    await fs.rm(targetPath, { force: true });
  } catch (error) {
    console.warn('Failed to remove temporary output:', targetPath, error);
  }
}

async function safelyRemovePasslog(passlogPrefix) {
  if (!passlogPrefix) return;
  await Promise.all([
    safelyRemove(`${passlogPrefix}-0.log`),
    safelyRemove(`${passlogPrefix}-0.log.mbtree`),
    safelyRemove(`${passlogPrefix}.log`),
    safelyRemove(`${passlogPrefix}.log.mbtree`),
  ]);
}

function releaseReservedOutputPath(targetPath) {
  if (targetPath) {
    reservedOutputPaths.delete(targetPath);
  }
}

function ffprobeMedia(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(metadata);
    });
  });
}

function inferDetectedType(inputPath, metadata) {
  const extension = path.extname(inputPath).toLowerCase();
  const formatName = String(metadata?.format?.format_name || '').toLowerCase();
  const videoStream = metadata?.streams?.find((stream) => stream.codec_type === 'video');
  const audioStream = metadata?.streams?.find((stream) => stream.codec_type === 'audio');
  const duration = normalizeDuration(metadata?.format?.duration || videoStream?.duration);
  const imageFormatHints = ['image2', 'jpeg_pipe', 'png_pipe', 'webp_pipe', 'bmp_pipe', 'tiff_pipe', 'gif'];

  if (IMAGE_INPUT_EXTENSIONS.has(extension) && !audioStream && !duration) {
    return 'image';
  }

  if (imageFormatHints.some((hint) => formatName.includes(hint)) && videoStream && !audioStream) {
    return 'image';
  }

  if (VIDEO_INPUT_EXTENSIONS.has(extension) && videoStream) {
    return 'video';
  }

  if (videoStream) {
    return audioStream || duration ? 'video' : 'image';
  }

  return null;
}

async function probeMedia(inputPath) {
  try {
    const metadata = await ffprobeMedia(inputPath);
    const videoStream = metadata?.streams?.find((stream) => stream.codec_type === 'video');
    const audioStream = metadata?.streams?.find((stream) => stream.codec_type === 'audio');
    const detectedType = inferDetectedType(inputPath, metadata);
    const width = Number.isFinite(videoStream?.width) ? videoStream.width : null;
    const height = Number.isFinite(videoStream?.height) ? videoStream.height : null;
    const duration = normalizeDuration(
      metadata?.format?.duration ||
      videoStream?.duration ||
      audioStream?.duration
    );

    if (!detectedType) {
      return {
        inputPath,
        detectedType: null,
        duration,
        width,
        height,
        hasAudio: Boolean(audioStream),
        dimensions: width && height ? { width, height } : null,
        progressMode: 'indeterminate',
        isSupported: false,
        reason: 'Unsupported media type.'
      };
    }

    return {
      inputPath,
      detectedType,
      duration,
      width,
      height,
      hasAudio: Boolean(audioStream),
      dimensions: width && height ? { width, height } : null,
      progressMode: detectedType === 'video' && duration ? 'determinate' : 'indeterminate',
      isSupported: true,
      reason: null
    };
  } catch (error) {
    return {
      inputPath,
      detectedType: null,
      duration: null,
      width: null,
      height: null,
      hasAudio: false,
      dimensions: null,
      progressMode: 'indeterminate',
      isSupported: false,
      reason: summarizeErrorMessage(error instanceof Error ? error.message : 'Unable to inspect this file.')
    };
  }
}

/**
 * Run a single ffmpeg invocation. Returns a promise resolving to `{ ok }` or
 * rejecting with an error. Wires progress/codec callbacks up through `ctx`.
 */
function runFfmpegPass(ctx, { inputOptions, outputOptions, outputPath, passRange }) {
  return new Promise((resolve, reject) => {
    const command = ffmpeg(ctx.job.inputPath);

    if (inputOptions && inputOptions.length > 0) {
      command.inputOptions(...inputOptions);
    }

    command.outputOptions(...outputOptions);
    command.output(outputPath);

    // Register this command with the cancel registry. For two-pass jobs we
    // just overwrite the current command each pass.
    const existing = activeConversions.get(ctx.job.jobId) || {};
    activeConversions.set(ctx.job.jobId, {
      ...existing,
      command,
      tempOutputPath: ctx.tempOutputPath,
      passlogPrefix: ctx.passlogPrefix,
      cancelRequested: existing.cancelRequested || false,
    });

    command.on('codecData', (data) => {
      const parsedDuration = parseTimemarkToSeconds(data?.duration);
      if (parsedDuration) {
        ctx.durationSeconds = parsedDuration;
      }
    });

    command.on('progress', (progress) => {
      const timemark = progress?.timemark || null;
      const fallbackPercent = timemark && ctx.durationSeconds
        ? (parseTimemarkToSeconds(timemark) / ctx.durationSeconds) * 100
        : null;
      const rawPercent = Number.isFinite(progress?.percent) ? progress.percent : fallbackPercent;
      if (!Number.isFinite(rawPercent)) {
        ctx.callbacks.onProgress?.({ percent: null, timemark });
        return;
      }

      const clamped = Math.max(0, Math.min(100, rawPercent));
      const [rangeStart, rangeEnd] = passRange || [0, 100];
      const scaled = rangeStart + (clamped / 100) * (rangeEnd - rangeStart);

      ctx.callbacks.onProgress?.({
        percent: Math.round(scaled),
        timemark,
      });
    });

    command.on('stderr', (line) => {
      if (typeof line !== 'string') return;
      ctx.stderrTail.push(line);
      if (ctx.stderrTail.length > 80) ctx.stderrTail.shift();

      if (!ctx.durationSeconds) {
        const match = line.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/i);
        const parsedDuration = parseTimemarkToSeconds(match?.[1]);

        if (parsedDuration) {
          ctx.durationSeconds = parsedDuration;
        }
      }
    });

    command.on('error', (error) => {
      const activeJob = activeConversions.get(ctx.job.jobId);

      if (activeJob?.cancelRequested || error?.message?.includes('SIGKILL') || error?.message?.includes('SIGTERM')) {
        const cancelledError = new Error('Conversion cancelled.');
        cancelledError.code = 'JOB_CANCELLED';
        reject(cancelledError);
        return;
      }

      reject(error);
    });

    command.on('end', () => {
      resolve();
    });

    command.run();
  });
}

function convertJob(job, callbacks = {}, options = {}) {
  const useGpu = options.useGpu !== false;

  return (async () => {
    let tempOutputPath = null;
    let finalOutputPath = null;
    let passlogPrefix = null;
    const jobOptions = resolveOptions(job.options);

    const ctx = {
      job,
      callbacks,
      durationSeconds: job.duration || null,
      stderrTail: [],
      tempOutputPath: null,
      passlogPrefix: null,
    };

    try {
      finalOutputPath = await resolveFinalOutputPath(job);
      tempOutputPath = buildTempOutputPath(job, finalOutputPath);
      ctx.tempOutputPath = tempOutputPath;
      await safelyRemove(tempOutputPath);

      activeConversions.set(job.jobId, { tempOutputPath, cancelRequested: false });

      const probe = {
        detectedType: job.detectedType,
        duration: job.duration,
        width: job.dimensions?.width || null,
        height: job.dimensions?.height || null,
        hasAudio: Boolean(job.hasAudio),
      };

      if (job.detectedType === 'image') {
        const outputArgs = buildImageOutputArgs(job.outputFormat, jobOptions, probe);
        await runFfmpegPass(ctx, {
          inputOptions: [],
          outputOptions: outputArgs,
          outputPath: tempOutputPath,
          passRange: [0, 100],
        });
      } else if (job.outputFormat === 'gif') {
        const built = buildGifVideoOutputArgs(jobOptions, probe);
        await runFfmpegPass(ctx, {
          inputOptions: built.inputOptions,
          outputOptions: built.outputOptions,
          outputPath: tempOutputPath,
          passRange: [0, 100],
        });
      } else {
        const gpuCapabilities = useGpu
          ? await detectHardwareAcceleration(ffmpegPath)
          : getCapabilities();
        const built = buildVideoOutputArgs(job.outputFormat, jobOptions, probe, gpuCapabilities);

        if (built.needsTwoPass) {
          passlogPrefix = path.join(job.outputDir, `${PASSLOG_PREFIX}${job.jobId}`);
          ctx.passlogPrefix = passlogPrefix;

          // Override the passlog prefix so it lands in the output dir.
          const pass1 = built.pass1OutputOptions.map((arg) =>
            arg === built.passlogPrefix ? passlogPrefix : arg
          );
          const pass2 = built.pass2OutputOptions.map((arg) =>
            arg === built.passlogPrefix ? passlogPrefix : arg
          );

          const nullOutput = process.platform === 'win32' ? 'NUL' : '/dev/null';

          await runFfmpegPass(ctx, {
            inputOptions: built.inputOptions,
            outputOptions: pass1,
            outputPath: nullOutput,
            passRange: [0, 50],
          });

          await runFfmpegPass(ctx, {
            inputOptions: built.inputOptions,
            outputOptions: pass2,
            outputPath: tempOutputPath,
            passRange: [50, 100],
          });
        } else {
          await runFfmpegPass(ctx, {
            inputOptions: built.inputOptions,
            outputOptions: built.outputOptions,
            outputPath: tempOutputPath,
            passRange: [0, 100],
          });
        }
      }

      activeConversions.delete(job.jobId);
      await fs.rename(tempOutputPath, finalOutputPath);
      releaseReservedOutputPath(finalOutputPath);

      if (passlogPrefix) {
        await safelyRemovePasslog(passlogPrefix);
      }

      callbacks.onProgress?.({ percent: 100, timemark: null });
      return { outputPath: finalOutputPath };
    } catch (error) {
      activeConversions.delete(job.jobId);
      releaseReservedOutputPath(finalOutputPath);
      await safelyRemove(tempOutputPath);

      if (passlogPrefix) {
        await safelyRemovePasslog(passlogPrefix);
      }

      if (error?.code === 'JOB_CANCELLED') {
        throw error;
      }

      const wrapped = new Error(summarizeErrorMessage(error?.message || 'FFmpeg conversion failed.'));
      wrapped.stderrTail = ctx.stderrTail.slice(-40).join('\n');
      throw wrapped;
    }
  })();
}

async function waitForConversionExit(jobId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!activeConversions.has(jobId)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return !activeConversions.has(jobId);
}

async function cancelConversion(jobId) {
  const activeJob = activeConversions.get(jobId);

  if (!activeJob) {
    return;
  }

  activeJob.cancelRequested = true;

  if (activeJob.command) {
    activeJob.command.kill('SIGTERM');
  }

  const exitedGracefully = await waitForConversionExit(jobId, 1200);

  if (exitedGracefully) {
    await safelyRemove(activeJob.tempOutputPath);
    if (activeJob.passlogPrefix) {
      await safelyRemovePasslog(activeJob.passlogPrefix);
    }
    return;
  }

  const forcedJob = activeConversions.get(jobId);

  if (forcedJob) {
    forcedJob.cancelRequested = true;
    if (forcedJob.command) {
      forcedJob.command.kill('SIGKILL');
    }
    await waitForConversionExit(jobId, 800);
    await safelyRemove(forcedJob.tempOutputPath);
    if (forcedJob.passlogPrefix) {
      await safelyRemovePasslog(forcedJob.passlogPrefix);
    }
  }
}

module.exports = {
  cleanupDirectoryArtifacts,
  convertJob,
  cancelConversion,
  probeMedia,
  detectHardwareAcceleration: () => detectHardwareAcceleration(ffmpegPath),
  getGpuCapabilities: getCapabilities,
};
