const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { dialog, ipcMain, shell } = require('electron/main');
const { clipboard } = require('electron');
const Store = require('electron-store').default;
const { JobQueue } = require('./jobQueue');
const {
  convertJob,
  cancelConversion,
  cleanupDirectoryArtifacts,
  probeMedia,
  detectHardwareAcceleration,
  getGpuCapabilities,
} = require('./converter');
const {
  DEFAULT_OPTIONS,
  resolveOptions,
  estimateOutputSize,
} = require('./encoderOptions');

const IMAGE_FORMATS = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff'];
const VIDEO_FORMATS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];
const HISTORY_LIMIT = 100;

// electron-store expects plain mutable JSON, not frozen objects.
function cloneDefaultOptions() {
  return JSON.parse(JSON.stringify(DEFAULT_OPTIONS));
}

const DEFAULT_SETTINGS = {
  defaultOutputDir: null,
  maxConcurrent: 1,
  useGpu: true,
  defaultFormats: {
    image: 'png',
    video: 'mp4'
  },
  defaultOptions: cloneDefaultOptions(),
  recentJobs: []
};

const store = new Store({
  projectName: 'my-converter',
  name: 'settings',
  defaults: DEFAULT_SETTINGS,
  schema: {
    defaultOutputDir: {
      type: ['string', 'null'],
      default: null
    },
    maxConcurrent: {
      type: 'number',
      minimum: 1,
      maximum: 4,
      default: 1
    },
    useGpu: {
      type: 'boolean',
      default: true
    },
    defaultFormats: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          enum: IMAGE_FORMATS,
          default: 'png'
        },
        video: {
          type: 'string',
          enum: VIDEO_FORMATS,
          default: 'mp4'
        }
      },
      default: DEFAULT_SETTINGS.defaultFormats
    },
    defaultOptions: {
      type: 'object',
      default: cloneDefaultOptions()
    },
    recentJobs: {
      type: 'array',
      default: []
    }
  }
});

function getAllowedFormats(type) {
  return type === 'image' ? IMAGE_FORMATS : VIDEO_FORMATS;
}

function clampConcurrency(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_SETTINGS.maxConcurrent;
  }

  return Math.max(1, Math.min(4, Math.trunc(numericValue)));
}

async function ensurePathExists(targetPath, expectedType) {
  const stats = await fs.stat(targetPath);

  if (expectedType === 'file' && !stats.isFile()) {
    throw new Error('Expected a file path.');
  }

  if (expectedType === 'directory' && !stats.isDirectory()) {
    throw new Error('Expected a directory path.');
  }

  return stats;
}

async function assertWritableDirectory(directoryPath) {
  await ensurePathExists(directoryPath, 'directory');
  await fs.access(directoryPath, fsConstants.W_OK);
}

function safeSend(getMainWindow, channel, payload) {
  const mainWindow = getMainWindow();

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send(channel, payload);
}

function nowIso() {
  return new Date().toISOString();
}

function trimHistory(entries) {
  return [...entries]
    .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0))
    .slice(0, HISTORY_LIMIT);
}

function getHistoryEntries() {
  return Array.isArray(store.get('recentJobs')) ? store.get('recentJobs') : [];
}

function setHistoryEntries(entries) {
  store.set('recentJobs', trimHistory(entries));
}

function hydrateHistoryOnStartup() {
  const entries = getHistoryEntries();
  let changed = false;

  const nextEntries = entries.map((entry) => {
    if (entry.status === 'queued' || entry.status === 'converting') {
      changed = true;
      return {
        ...entry,
        status: 'cancelled',
        errorMessage: entry.errorMessage || 'The previous session ended before this conversion finished.',
        updatedAt: nowIso()
      };
    }

    return entry;
  });

  if (changed) {
    setHistoryEntries(nextEntries);
  }
}

function summarizeHistoryJob(job) {
  return {
    jobId: job.jobId,
    requestId: job.requestId || null,
    inputPath: job.inputPath,
    fileName: job.fileName,
    fileSize: job.fileSize,
    detectedType: job.detectedType,
    outputFormat: job.outputFormat,
    outputDir: job.outputDir,
    outputPath: job.outputPath || null,
    status: job.status,
    progressMode: job.progressMode || 'indeterminate',
    duration: job.duration || null,
    dimensions: job.dimensions || null,
    hasAudio: Boolean(job.hasAudio),
    options: job.options || null,
    errorMessage: job.errorMessage || null,
    stderrTail: job.stderrTail || null,
    updatedAt: job.updatedAt || nowIso()
  };
}

function upsertHistoryEntry(jobPatch) {
  const currentEntries = getHistoryEntries();
  const nextEntry = summarizeHistoryJob(jobPatch);
  const existingIndex = currentEntries.findIndex((entry) => entry.jobId === nextEntry.jobId);

  if (existingIndex >= 0) {
    const merged = {
      ...currentEntries[existingIndex],
      ...nextEntry,
      updatedAt: nowIso()
    };
    currentEntries.splice(existingIndex, 1, merged);
    setHistoryEntries(currentEntries);
    return merged;
  }

  const merged = {
    ...nextEntry,
    updatedAt: nowIso()
  };
  setHistoryEntries([merged, ...currentEntries]);
  return merged;
}

function removeHistoryEntries(jobIds) {
  const idSet = new Set(jobIds);
  setHistoryEntries(getHistoryEntries().filter((entry) => !idSet.has(entry.jobId)));
}

function registerHandler(channel, handler) {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return await handler(payload);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Unknown error.'
      };
    }
  });
}

async function enrichFileSelection(inputPath) {
  const stats = await ensurePathExists(inputPath, 'file');
  const probe = await probeMedia(inputPath);

  return {
    inputPath,
    fileName: path.basename(inputPath),
    fileSize: stats.size,
    detectedType: probe.detectedType,
    duration: probe.duration,
    dimensions: probe.dimensions,
    hasAudio: probe.hasAudio,
    progressMode: probe.progressMode,
    isSupported: probe.isSupported,
    reason: probe.reason
  };
}

async function normalizeSelectedPaths(filePaths) {
  const normalized = [];

  for (const inputPath of filePaths) {
    try {
      normalized.push(await enrichFileSelection(inputPath));
    } catch (error) {
      normalized.push({
        inputPath,
        fileName: path.basename(inputPath),
        fileSize: 0,
        detectedType: null,
        duration: null,
        dimensions: null,
        hasAudio: false,
        progressMode: 'indeterminate',
        isSupported: false,
        reason: error instanceof Error ? error.message : 'Unable to inspect this file.'
      });
    }
  }

  return normalized;
}

/**
 * Merge global default options with per-job overrides.
 * Deep-merge at the top level + `resize` + `video` + `video.audio`.
 */
function mergeWithDefaults(userOptions) {
  const globalDefaults = store.get('defaultOptions') || DEFAULT_OPTIONS;
  const user = userOptions && typeof userOptions === 'object' ? userOptions : {};

  const merged = {
    quality: user.quality ?? globalDefaults.quality,
    resize: {
      ...(globalDefaults.resize || {}),
      ...(user.resize || {}),
    },
    video: {
      ...(globalDefaults.video || {}),
      ...(user.video || {}),
      audio: {
        ...((globalDefaults.video && globalDefaults.video.audio) || {}),
        ...((user.video && user.video.audio) || {}),
      },
    },
  };

  return resolveOptions(merged);
}

async function createJobFromRequest(fileRequest, requestedOutputDir) {
  if (!fileRequest || typeof fileRequest !== 'object') {
    throw new Error('Invalid file entry.');
  }

  const { inputPath, outputFormat } = fileRequest;

  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Missing input path.');
  }

  if (!outputFormat || typeof outputFormat !== 'string') {
    throw new Error('Missing output format.');
  }

  const normalizedPath = path.normalize(inputPath);
  const stats = await ensurePathExists(normalizedPath, 'file');
  const probe = await probeMedia(normalizedPath);

  if (!probe.isSupported || !probe.detectedType) {
    throw new Error(probe.reason || 'Unsupported input file type.');
  }

  const normalizedFormat = outputFormat.toLowerCase();
  const allowedFormats = getAllowedFormats(probe.detectedType);

  if (!allowedFormats.includes(normalizedFormat)) {
    throw new Error(`Unsupported output format for ${probe.detectedType}.`);
  }

  const derivedOutputDir = requestedOutputDir || store.get('defaultOutputDir') || path.dirname(normalizedPath);
  await assertWritableDirectory(derivedOutputDir);

  const resolvedOptions = mergeWithDefaults(fileRequest.options);

  return {
    jobId: randomUUID(),
    requestId: typeof fileRequest.requestId === 'string' ? fileRequest.requestId : randomUUID(),
    inputPath: normalizedPath,
    fileName: path.basename(normalizedPath),
    fileSize: stats.size,
    detectedType: probe.detectedType,
    outputFormat: normalizedFormat,
    outputDir: derivedOutputDir,
    outputPath: null,
    status: 'queued',
    progressMode: probe.progressMode,
    duration: probe.duration,
    dimensions: probe.dimensions,
    hasAudio: probe.hasAudio,
    options: resolvedOptions,
    errorMessage: null,
    stderrTail: null,
    updatedAt: nowIso()
  };
}

function registerIpcHandlers({ getMainWindow }) {
  hydrateHistoryOnStartup();
  const knownJobs = new Map();

  // Kick off GPU detection (async, non-blocking).
  detectHardwareAcceleration().then((caps) => {
    console.log('[ipc] GPU capabilities ready:', caps.label);
    safeSend(getMainWindow, 'gpu:status', {
      available: caps.available,
      vendor: caps.vendor,
      label: caps.label,
      detecting: Boolean(caps.detecting),
    });
  }).catch((error) => {
    console.warn('[ipc] GPU detection failed, falling back to CPU:', error);
    safeSend(getMainWindow, 'gpu:status', {
      available: false,
      vendor: null,
      label: 'CPU only',
      detecting: false,
    });
  });

  function rememberJob(jobPatch) {
    const existing = knownJobs.get(jobPatch.jobId) || {};
    const nextJob = {
      ...existing,
      ...jobPatch,
      updatedAt: nowIso()
    };

    knownJobs.set(nextJob.jobId, nextJob);
    upsertHistoryEntry(nextJob);
    return nextJob;
  }

  const queue = new JobQueue({
    concurrency: clampConcurrency(store.get('maxConcurrent')),
    convertJob: async (job, callbacks) => {
      await cleanupDirectoryArtifacts(job.outputDir);
      return convertJob(job, callbacks, { useGpu: store.get('useGpu', true) });
    },
    cancelJob: async (jobId) => cancelConversion(jobId),
    onStatus: ({ jobId, status }) => {
      const job = knownJobs.get(jobId);

      if (job) {
        rememberJob({
          ...job,
          status,
          errorMessage: status === 'cancelled' ? job.errorMessage || 'Conversion cancelled.' : job.errorMessage
        });
      }

      safeSend(getMainWindow, 'convert:status', { jobId, status });
    },
    onProgress: ({ jobId, percent, timemark }) => {
      const job = knownJobs.get(jobId);

      if (job) {
        knownJobs.set(jobId, {
          ...job,
          percent: typeof percent === 'number' ? percent : job.percent,
          timemark: timemark ?? job.timemark,
          updatedAt: nowIso()
        });
      }

      safeSend(getMainWindow, 'convert:progress', { jobId, percent, timemark });
    },
    onDone: ({ jobId, outputPath }) => {
      const job = knownJobs.get(jobId);

      if (job) {
        rememberJob({
          ...job,
          outputPath,
          status: 'done',
          errorMessage: null
        });
      }

      safeSend(getMainWindow, 'convert:done', { jobId, outputPath });
    },
    onError: ({ jobId, message, stderrTail }) => {
      const job = knownJobs.get(jobId);

      if (job) {
        rememberJob({
          ...job,
          status: 'failed',
          errorMessage: message,
          stderrTail: stderrTail || null
        });
      }

      safeSend(getMainWindow, 'convert:error', { jobId, message, stderrTail: stderrTail || null });
    }
  });

  registerHandler('media:probe', async (payload) => {
    const inputPaths = Array.isArray(payload?.inputPaths) ? payload.inputPaths : [];
    return {
      ok: true,
      files: await normalizeSelectedPaths(inputPaths)
    };
  });

  registerHandler('media:estimateSize', async (payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const results = items.map((item) => {
      try {
        const probe = {
          detectedType: item.detectedType,
          duration: item.duration,
          width: item.width || item?.dimensions?.width,
          height: item.height || item?.dimensions?.height,
        };
        const resolved = mergeWithDefaults(item.options);
        const bytes = estimateOutputSize(probe, resolved, item.outputFormat);
        return { requestId: item.requestId, bytes };
      } catch (error) {
        return { requestId: item.requestId, bytes: null };
      }
    });
    return { ok: true, estimates: results };
  });

  registerHandler('convert:start', async (payload) => {
    const files = Array.isArray(payload?.files) ? payload.files : [];
    const requestedOutputDir = typeof payload?.outputDir === 'string' && payload.outputDir.trim()
      ? payload.outputDir.trim()
      : null;
    const jobs = [];
    const rejectedFiles = [];

    for (const fileRequest of files) {
      try {
        const job = await createJobFromRequest(fileRequest, requestedOutputDir);
        jobs.push(job);
        rememberJob(job);
      } catch (error) {
        rejectedFiles.push({
          requestId: typeof fileRequest?.requestId === 'string' ? fileRequest.requestId : null,
          inputPath: fileRequest?.inputPath || null,
          message: error instanceof Error ? error.message : 'Unknown error.'
        });
      }
    }

    if (jobs.length > 0) {
      setImmediate(() => {
        queue.enqueueJobs(jobs);
      });
    }

    return {
      ok: true,
      jobs,
      rejectedFiles
    };
  });

  registerHandler('convert:cancel', async (payload) => {
    if (!payload?.jobId || typeof payload.jobId !== 'string') {
      throw new Error('Missing job identifier.');
    }

    const status = await queue.cancelJob(payload.jobId);
    return {
      ok: true,
      status
    };
  });

  registerHandler('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.get('defaultOutputDir') || undefined
    });

    return {
      canceled: result.canceled,
      folderPath: result.canceled ? null : result.filePaths[0]
    };
  });

  registerHandler('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media files',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tif', 'tiff', 'mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'mpg', 'mpeg']
        }
      ]
    });

    return {
      canceled: result.canceled,
      files: result.canceled ? [] : await normalizeSelectedPaths(result.filePaths)
    };
  });

  registerHandler('shell:showItemInFolder', async (payload) => {
    if (!payload?.targetPath || typeof payload.targetPath !== 'string') {
      throw new Error('Missing target path.');
    }

    shell.showItemInFolder(payload.targetPath);
    return { ok: true };
  });

  registerHandler('shell:copyPath', async (payload) => {
    if (!payload?.targetPath || typeof payload.targetPath !== 'string') {
      throw new Error('Missing target path.');
    }

    clipboard.writeText(payload.targetPath);
    return { ok: true };
  });

  registerHandler('jobs:history:get', async () => {
    return {
      ok: true,
      jobs: getHistoryEntries()
    };
  });

  registerHandler('jobs:history:clear', async () => {
    setHistoryEntries([]);
    return { ok: true };
  });

  registerHandler('jobs:remove', async (payload) => {
    const jobIds = Array.isArray(payload?.jobIds) ? payload.jobIds.filter((jobId) => typeof jobId === 'string') : [];
    removeHistoryEntries(jobIds);

    for (const jobId of jobIds) {
      knownJobs.delete(jobId);
    }

    return {
      ok: true,
      removed: jobIds
    };
  });

  registerHandler('jobs:retry', async (payload) => {
    const jobIds = Array.isArray(payload?.jobIds) ? payload.jobIds.filter((jobId) => typeof jobId === 'string') : [];
    const historyEntries = getHistoryEntries().filter((entry) => jobIds.includes(entry.jobId));
    const jobs = [];
    const rejectedFiles = [];

    for (const entry of historyEntries) {
      try {
        const job = await createJobFromRequest({
          requestId: randomUUID(),
          inputPath: entry.inputPath,
          outputFormat: entry.outputFormat,
          options: entry.options || null
        }, entry.outputDir || null);
        jobs.push(job);
        rememberJob(job);
      } catch (error) {
        rejectedFiles.push({
          requestId: entry.requestId,
          inputPath: entry.inputPath,
          message: error instanceof Error ? error.message : 'Unknown error.'
        });
      }
    }

    if (jobs.length > 0) {
      setImmediate(() => {
        queue.enqueueJobs(jobs);
      });
    }

    return {
      ok: true,
      jobs,
      rejectedFiles
    };
  });

  registerHandler('settings:get', async () => {
    const caps = getGpuCapabilities();
    return {
      ok: true,
      settings: {
        defaultOutputDir: store.get('defaultOutputDir'),
        maxConcurrent: clampConcurrency(store.get('maxConcurrent')),
        useGpu: store.get('useGpu', true),
        defaultFormats: store.get('defaultFormats'),
        defaultOptions: resolveOptions(store.get('defaultOptions') || DEFAULT_OPTIONS)
      },
      gpu: {
        available: caps.available,
        vendor: caps.vendor,
        label: caps.label,
        detecting: Boolean(caps.detecting),
      }
    };
  });

  registerHandler('settings:update', async (payload) => {
    const nextSettings = {
      defaultOutputDir: payload?.defaultOutputDir ?? store.get('defaultOutputDir'),
      maxConcurrent: clampConcurrency(payload?.maxConcurrent ?? store.get('maxConcurrent')),
      useGpu: typeof payload?.useGpu === 'boolean' ? payload.useGpu : store.get('useGpu', true),
      defaultFormats: {
        image: payload?.defaultFormats?.image || store.get('defaultFormats.image'),
        video: payload?.defaultFormats?.video || store.get('defaultFormats.video')
      },
      defaultOptions: payload?.defaultOptions
        ? resolveOptions(payload.defaultOptions)
        : resolveOptions(store.get('defaultOptions') || DEFAULT_OPTIONS)
    };

    if (nextSettings.defaultOutputDir) {
      await assertWritableDirectory(nextSettings.defaultOutputDir);
    } else {
      nextSettings.defaultOutputDir = null;
    }

    if (!IMAGE_FORMATS.includes(nextSettings.defaultFormats.image)) {
      throw new Error('Invalid default image format.');
    }

    if (!VIDEO_FORMATS.includes(nextSettings.defaultFormats.video)) {
      throw new Error('Invalid default video format.');
    }

    store.set({
      defaultOutputDir: nextSettings.defaultOutputDir,
      maxConcurrent: nextSettings.maxConcurrent,
      useGpu: nextSettings.useGpu,
      defaultFormats: nextSettings.defaultFormats,
      defaultOptions: nextSettings.defaultOptions
    });
    queue.setConcurrency(nextSettings.maxConcurrent);

    return {
      ok: true,
      settings: nextSettings
    };
  });

  return {
    queue,
    dispose: async () => {
      await queue.dispose();
    }
  };
}

module.exports = {
  IMAGE_FORMATS,
  VIDEO_FORMATS,
  DEFAULT_SETTINGS,
  registerIpcHandlers
};
