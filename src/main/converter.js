const fs = require('node:fs/promises');
const path = require('node:path');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');
const {
  detectHardwareAcceleration,
  getCapabilities,
  getVideoOutputOptions: getGpuVideoOutputOptions,
} = require('./gpu');

const TEMP_PREFIX = '.my-converter-temp-';
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
    const tempFiles = entries.filter((entry) => entry.startsWith(TEMP_PREFIX));
    const activeTempPaths = new Set(
      Array.from(activeConversions.values())
        .map((item) => item.tempOutputPath)
        .filter(Boolean)
    );

    await Promise.all(tempFiles.map(async (entry) => {
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

function getVideoOutputOptions(format, useGpu, caps = getCapabilities()) {
  const enableGpu = useGpu && caps.available;
  const tokens = getGpuVideoOutputOptions(format, enableGpu, caps.vendor);
  // Convert flat token array into space-joined pairs for applyCommandOptions.
  const options = [];
  for (let i = 0; i < tokens.length; i += 2) {
    options.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return options;
}

function getImageOutputOptions(format) {
  const formatSpecificOptions = {
    jpg: ['-c:v mjpeg', '-q:v 2'],
    png: ['-c:v png'],
    webp: ['-c:v libwebp', '-quality 90'],
    avif: ['-c:v libaom-av1', '-still-picture 1', '-crf 28', '-cpu-used 4'],
    gif: ['-c:v gif'],
    bmp: ['-c:v bmp'],
    tiff: ['-c:v tiff']
  };

  return ['-vf scale=iw:ih', ...(formatSpecificOptions[format] || [])];
}

function applyCommandOptions(command, options) {
  for (const option of options) {
    const segments = option.split(' ');
    command.outputOptions(segments[0], ...segments.slice(1));
  }
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

function convertJob(job, callbacks = {}, options = {}) {
  const useGpu = options.useGpu !== false;
  return new Promise(async (resolve, reject) => {
    let tempOutputPath = null;
    let finalOutputPath = null;
    let durationSeconds = job.duration || null;
    let command = null;

    try {
      finalOutputPath = await resolveFinalOutputPath(job);
      tempOutputPath = buildTempOutputPath(job, finalOutputPath);
      await safelyRemove(tempOutputPath);

      command = ffmpeg(job.inputPath);
      activeConversions.set(job.jobId, {
        command,
        tempOutputPath,
        cancelRequested: false
      });

      command.on('codecData', (data) => {
        const parsedDuration = parseTimemarkToSeconds(data?.duration);
        if (parsedDuration) {
          durationSeconds = parsedDuration;
        }
      });

      command.on('progress', (progress) => {
        const timemark = progress?.timemark || null;
        const fallbackPercent = timemark && durationSeconds
          ? (parseTimemarkToSeconds(timemark) / durationSeconds) * 100
          : null;
        const percent = Number.isFinite(progress?.percent)
          ? progress.percent
          : fallbackPercent;

        callbacks.onProgress?.({
          percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : null,
          timemark
        });
      });

      command.on('stderr', (line) => {
        if (!durationSeconds && typeof line === 'string') {
          const match = line.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/i);
          const parsedDuration = parseTimemarkToSeconds(match?.[1]);

          if (parsedDuration) {
            durationSeconds = parsedDuration;
          }
        }
      });

      command.on('error', async (error) => {
        const activeJob = activeConversions.get(job.jobId);
        activeConversions.delete(job.jobId);
        releaseReservedOutputPath(finalOutputPath);
        await safelyRemove(tempOutputPath);

        if (activeJob?.cancelRequested || error?.message?.includes('SIGKILL') || error?.message?.includes('SIGTERM')) {
          const cancelledError = new Error('Conversion cancelled.');
          cancelledError.code = 'JOB_CANCELLED';
          reject(cancelledError);
          return;
        }

        reject(new Error(summarizeErrorMessage(error?.message || 'FFmpeg conversion failed.')));
      });

      command.on('end', async () => {
        try {
          activeConversions.delete(job.jobId);
          await fs.rename(tempOutputPath, finalOutputPath);
          releaseReservedOutputPath(finalOutputPath);
          callbacks.onProgress?.({ percent: 100, timemark: null });
          resolve({ outputPath: finalOutputPath });
        } catch (error) {
          releaseReservedOutputPath(finalOutputPath);
          await safelyRemove(tempOutputPath);
          reject(error);
        }
      });

      if (job.detectedType === 'image') {
        applyCommandOptions(command, getImageOutputOptions(job.outputFormat));
        command.output(tempOutputPath);
      } else if (job.outputFormat === 'gif') {
        command.outputOptions(
          '-vf',
          'fps=12,scale=iw:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse'
        );
        command.noAudio();
        command.output(tempOutputPath);
      } else {
        const gpuCapabilities = useGpu
          ? await detectHardwareAcceleration(ffmpegPath)
          : getCapabilities();

        applyCommandOptions(command, getVideoOutputOptions(job.outputFormat, useGpu, gpuCapabilities));
        command.output(tempOutputPath);
      }

      command.run();
    } catch (error) {
      activeConversions.delete(job.jobId);
      releaseReservedOutputPath(finalOutputPath);
      await safelyRemove(tempOutputPath);
      reject(new Error(summarizeErrorMessage(error instanceof Error ? error.message : 'Conversion failed.')));
    }
  });
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
  activeJob.command.kill('SIGTERM');

  const exitedGracefully = await waitForConversionExit(jobId, 1200);

  if (exitedGracefully) {
    await safelyRemove(activeJob.tempOutputPath);
    return;
  }

  const forcedJob = activeConversions.get(jobId);

  if (forcedJob) {
    forcedJob.cancelRequested = true;
    forcedJob.command.kill('SIGKILL');
    await waitForConversionExit(jobId, 800);
    await safelyRemove(forcedJob.tempOutputPath);
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
