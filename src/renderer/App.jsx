import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import BulkActionsBar from './components/BulkActionsBar';
import DropZone from './components/DropZone';
import FormatPicker from './components/FormatPicker';
import JobList from './components/JobList';
import OptionsPanel from './components/OptionsPanel';
import QueueToolbar from './components/QueueToolbar';
import Toast from './components/Toast';

const DEFAULT_JOB_OPTIONS = {
  quality: 'medium',
  resize: { mode: 'none', keepAspect: true },
  video: {
    rateControl: 'quality',
    fps: null,
    audio: { mode: 'keep', bitrateKbps: 192 },
    trim: null,
    crop: null,
  },
};

const IMAGE_FORMATS = ['jpg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff'];
const VIDEO_FORMATS = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'gif'];
const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

function createDraftJob(file, defaultFormats) {
  return {
    clientId: `${file.inputPath}-${crypto.randomUUID()}`,
    jobId: null,
    requestId: null,
    inputPath: file.inputPath,
    fileName: file.fileName,
    fileSize: file.fileSize,
    detectedType: file.detectedType,
    outputFormat: file.outputFormat || defaultFormats[file.detectedType],
    outputDir: file.outputDir || null,
    outputPath: file.outputPath || null,
    percent: typeof file.percent === 'number' ? file.percent : 0,
    timemark: file.timemark || null,
    errorMessage: file.errorMessage || null,
    status: file.status || 'pending-edit',
    progressMode: file.progressMode || 'indeterminate',
    duration: file.duration || null,
    dimensions: file.dimensions || null,
    hasAudio: Boolean(file.hasAudio),
    optionsOverride: file.optionsOverride || null
  };
}

function normalizeRecentJob(job) {
  return {
    clientId: job.jobId || `${job.inputPath}-${crypto.randomUUID()}`,
    jobId: job.jobId,
    requestId: job.requestId || null,
    inputPath: job.inputPath,
    fileName: job.fileName,
    fileSize: job.fileSize,
    detectedType: job.detectedType,
    outputFormat: job.outputFormat,
    outputDir: job.outputDir || null,
    outputPath: job.outputPath || null,
    percent: job.status === 'done' ? 100 : (typeof job.percent === 'number' ? job.percent : 0),
    timemark: job.timemark || null,
    errorMessage: job.errorMessage || null,
    status: job.status || 'done',
    progressMode: job.progressMode || 'indeterminate',
    duration: job.duration || null,
    dimensions: job.dimensions || null,
    hasAudio: Boolean(job.hasAudio)
  };
}

function formatPathSummary(targetPath) {
  if (!targetPath) {
    return 'Same as source folder';
  }

  return targetPath.length > 36 ? `${targetPath.slice(0, 16)}...${targetPath.slice(-16)}` : targetPath;
}

function buildAggregateMessage(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function isReadyJob(job) {
  return !job.jobId && job.status === 'pending-edit';
}

function ChevronDown({ open }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

export default function App() {
  const [jobs, setJobs] = useState([]);
  const [recentJobs, setRecentJobs] = useState([]);
  const [settings, setSettings] = useState({
    defaultOutputDir: null,
    maxConcurrent: 1,
    useGpu: true,
    defaultFormats: { image: 'png', video: 'mp4' },
    defaultOptions: DEFAULT_JOB_OPTIONS
  });
  const [gpuInfo, setGpuInfo] = useState({ available: false, vendor: null, label: 'Detecting...', detecting: true });
  const [selectedOutputDir, setSelectedOutputDir] = useState('');
  const [toasts, setToasts] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState(() => new Set());
  const [queueScope, setQueueScope] = useState('all');
  const [bulkScope, setBulkScope] = useState('all');

  const supportedFormats = useMemo(() => ({
    image: IMAGE_FORMATS,
    video: VIDEO_FORMATS
  }), []);

  const pushToast = useCallback((type, message) => {
    setToasts((currentToasts) => [...currentToasts, {
      id: crypto.randomUUID(),
      type,
      message
    }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((currentToasts) => currentToasts.filter((toast) => toast.id !== id));
  }, []);

  const toggleExpanded = useCallback((rowKey) => {
    setExpandedRows((current) => {
      const next = new Set(current);

      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }

      return next;
    });
  }, []);

  const forceExpand = useCallback((rowKey) => {
    setExpandedRows((current) => new Set([...current, rowKey]));
  }, []);

  const updateAnyJobById = useEffectEvent((jobId, updater) => {
    setJobs((currentJobs) => currentJobs.map((job) => (
      job.jobId === jobId ? updater(job) : job
    )));
    setRecentJobs((currentJobs) => currentJobs.map((job) => (
      job.jobId === jobId ? updater(job) : job
    )));
  });

  const promoteJobToRecent = useEffectEvent((jobId, updater) => {
    let movedJob = null;

    setJobs((currentJobs) => currentJobs.filter((job) => {
      if (job.jobId !== jobId) {
        return true;
      }

      movedJob = typeof updater === 'function' ? updater(job) : { ...job, ...updater };
      return false;
    }));

    setRecentJobs((currentJobs) => {
      const nextJobs = currentJobs.filter((job) => job.jobId !== jobId);
      const existingJob = currentJobs.find((job) => job.jobId === jobId);
      const targetJob = movedJob || (existingJob ? (typeof updater === 'function' ? updater(existingJob) : { ...existingJob, ...updater }) : null);

      if (!targetJob) {
        return nextJobs;
      }

      return [targetJob, ...nextJobs];
    });

    forceExpand(jobId);
  });

  const handleProgress = useEffectEvent(({ jobId, percent, timemark }) => {
    updateAnyJobById(jobId, (job) => ({
      ...job,
      percent: typeof percent === 'number' ? percent : job.percent,
      timemark: timemark ?? job.timemark
    }));
  });

  const handleDone = useEffectEvent(({ jobId, outputPath }) => {
    promoteJobToRecent(jobId, (job) => ({
      ...job,
      outputPath,
      percent: 100,
      status: 'done',
      errorMessage: null
    }));
  });

  const handleError = useEffectEvent(({ jobId, message }) => {
    promoteJobToRecent(jobId, (job) => ({
      ...job,
      status: 'failed',
      errorMessage: message
    }));
  });

  const handleStatus = useEffectEvent(({ jobId, status }) => {
    if (status === 'cancelled') {
      promoteJobToRecent(jobId, (job) => ({
        ...job,
        status,
        errorMessage: job.errorMessage || 'Conversion cancelled.'
      }));
      return;
    }

    if (status === 'queued' || status === 'converting') {
      updateAnyJobById(jobId, (job) => ({
        ...job,
        status,
        startedAt: status === 'converting' && !job.startedAt ? Date.now() : job.startedAt
      }));
      return;
    }

    if (status === 'failed') {
      updateAnyJobById(jobId, (job) => ({
        ...job,
        status
      }));
      forceExpand(jobId);
    }
  });

  useEffect(() => {
    let mounted = true;

    async function loadBootstrapData() {
      try {
        const [settingsResponse, historyResponse] = await Promise.all([
          window.converter.getSettings(),
          window.converter.getJobHistory()
        ]);

        if (!mounted) {
          return;
        }

        if (!settingsResponse.ok) {
          throw new Error(settingsResponse.message || 'Failed to load settings.');
        }

        setSettings(settingsResponse.settings);
        setSelectedOutputDir(settingsResponse.settings.defaultOutputDir || '');

        if (settingsResponse.gpu) {
          setGpuInfo(settingsResponse.gpu);
        }

        if (historyResponse.ok) {
          setRecentJobs(historyResponse.jobs.map((job) => normalizeRecentJob(job)));
        }
      } catch (error) {
        if (mounted) {
          pushToast('error', error.message);
        }
      } finally {
        if (mounted) {
          setIsLoadingSettings(false);
        }
      }
    }

    loadBootstrapData();

    const unsubscribers = [
      window.converter.onGpuStatus(setGpuInfo),
      window.converter.onProgress(handleProgress),
      window.converter.onDone(handleDone),
      window.converter.onError(handleError),
      window.converter.onStatus(handleStatus)
    ];

    return () => {
      mounted = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [handleDone, handleError, handleProgress, handleStatus, pushToast]);

  const ingestFiles = useEffectEvent(async (incomingFiles) => {
    const existingPaths = new Set(
      jobs
        .filter((job) => !TERMINAL_STATUSES.has(job.status))
        .map((job) => job.inputPath)
    );

    const dedupedFiles = [];
    const duplicatePaths = [];

    for (const file of incomingFiles) {
      if (existingPaths.has(file.inputPath)) {
        duplicatePaths.push(file.inputPath);
        continue;
      }

      dedupedFiles.push(file);
      existingPaths.add(file.inputPath);
    }

    const filesNeedingProbe = dedupedFiles.filter((file) => typeof file.isSupported !== 'boolean');
    let probeMap = new Map();

    if (filesNeedingProbe.length > 0) {
      const probeResponse = await window.converter.probeMedia(filesNeedingProbe.map((file) => file.inputPath));

      if (!probeResponse.ok) {
        throw new Error(probeResponse.message || 'Failed to inspect selected files.');
      }

      probeMap = new Map(probeResponse.files.map((file) => [file.inputPath, file]));
    }

    const addedJobs = [];
    let rejectedCount = 0;

    for (const file of dedupedFiles) {
      const metadata = typeof file.isSupported === 'boolean'
        ? file
        : probeMap.get(file.inputPath);

      if (!metadata?.isSupported || !metadata.detectedType) {
        rejectedCount += 1;
        continue;
      }

      addedJobs.push(createDraftJob({
        ...file,
        ...metadata
      }, settings.defaultFormats));
    }

    if (addedJobs.length > 0) {
      setJobs((currentJobs) => [...addedJobs, ...currentJobs]);
    }

    if (addedJobs.length > 0) {
      pushToast('success', `${buildAggregateMessage(addedJobs.length, 'file')} added.`);
    }

    if (duplicatePaths.length > 0) {
      pushToast('warning', `${buildAggregateMessage(duplicatePaths.length, 'duplicate file')} skipped.`);
    }

    if (rejectedCount > 0) {
      pushToast('error', `${buildAggregateMessage(rejectedCount, 'file')} could not be added.`);
    }
  });

  const handleBrowseFiles = useEffectEvent(async () => {
    const response = await window.converter.openFileDialog();

    if (response.canceled || response.files.length === 0) {
      return;
    }

    await ingestFiles(response.files);
  });

  async function persistSettings(nextSettings) {
    const response = await window.converter.updateSettings(nextSettings);

    if (!response.ok) {
      throw new Error(response.message || 'Failed to update settings.');
    }

    setSettings(response.settings);
    setSelectedOutputDir(response.settings.defaultOutputDir || '');
  }

  async function handleOutputDirectoryPick() {
    const result = await window.converter.openFolderDialog();

    if (result.canceled || !result.folderPath) {
      return;
    }

    try {
      await persistSettings({
        ...settings,
        defaultOutputDir: result.folderPath
      });
    } catch (error) {
      pushToast('error', error.message);
    }
  }

  async function handleClearOutputDirectory() {
    try {
      await persistSettings({
        ...settings,
        defaultOutputDir: null
      });
    } catch (error) {
      pushToast('error', error.message);
    }
  }

  async function handleDefaultFormatChange(type, value) {
    try {
      await persistSettings({
        ...settings,
        defaultFormats: {
          ...settings.defaultFormats,
          [type]: value
        }
      });

      setJobs((currentJobs) => currentJobs.map((job) => (
        isReadyJob(job) && job.detectedType === type
          ? { ...job, outputFormat: value }
          : job
      )));
    } catch (error) {
      pushToast('error', error.message);
    }
  }

  async function handleConcurrencyChange(event) {
    try {
      await persistSettings({
        ...settings,
        maxConcurrent: Number(event.target.value)
      });
    } catch (error) {
      pushToast('error', error.message);
    }
  }

  async function handleDefaultOptionsChange(nextOptions) {
    try {
      await persistSettings({
        ...settings,
        defaultOptions: nextOptions
      });
    } catch (error) {
      pushToast('error', error.message);
    }
  }

  function handleJobFormatChange(clientId, outputFormat) {
    setJobs((currentJobs) => currentJobs.map((job) => (
      job.clientId === clientId
        ? { ...job, outputFormat }
        : job
    )));
  }

  function handleJobOptionsChange(clientId, nextOverride) {
    setJobs((currentJobs) => currentJobs.map((job) => (
      job.clientId === clientId
        ? { ...job, optionsOverride: nextOverride }
        : job
    )));
  }

  function handleJobOptionsClear(clientId) {
    setJobs((currentJobs) => currentJobs.map((job) => (
      job.clientId === clientId
        ? { ...job, optionsOverride: null }
        : job
    )));
  }

  function jobMatchesScope(job, scope) {
    if (job.status !== 'pending-edit') return false;
    if (scope === 'images') return job.detectedType === 'image';
    if (scope === 'videos') return job.detectedType === 'video';
    return true;
  }

  function handleBulkSetFormat(scope, outputFormat) {
    setJobs((currentJobs) => currentJobs.map((job) => (
      jobMatchesScope(job, scope) && supportedFormats[job.detectedType].includes(outputFormat)
        ? { ...job, outputFormat }
        : job
    )));
    pushToast('success', `Applied format ${outputFormat.toUpperCase()} to matching files.`);
  }

  function handleBulkSetQuality(scope, quality) {
    setJobs((currentJobs) => currentJobs.map((job) => {
      if (!jobMatchesScope(job, scope)) return job;
      const base = job.optionsOverride || settings.defaultOptions || DEFAULT_JOB_OPTIONS;
      return { ...job, optionsOverride: { ...base, quality } };
    }));
    pushToast('success', `Set quality preset to ${quality}.`);
  }

  function handleBulkSetResize(scope, resizePatch) {
    setJobs((currentJobs) => currentJobs.map((job) => {
      if (!jobMatchesScope(job, scope)) return job;
      const base = job.optionsOverride || settings.defaultOptions || DEFAULT_JOB_OPTIONS;
      const nextResize = { ...(base.resize || {}), ...resizePatch };
      return { ...job, optionsOverride: { ...base, resize: nextResize } };
    }));
    pushToast('success', 'Updated resize for matching files.');
  }

  function handleBulkClearOverrides(scope) {
    let cleared = 0;
    setJobs((currentJobs) => currentJobs.map((job) => {
      if (!jobMatchesScope(job, scope) || !job.optionsOverride) return job;
      cleared += 1;
      return { ...job, optionsOverride: null };
    }));
    pushToast('info', cleared > 0 ? `Cleared overrides on ${cleared} file${cleared === 1 ? '' : 's'}.` : 'No overrides to clear.');
  }

  async function handleRevealOutput(targetPath) {
    const response = await window.converter.openInFolder(targetPath);

    if (!response.ok) {
      pushToast('error', response.message || 'Failed to reveal output file.');
    }
  }

  async function handleCopyPath(targetPath) {
    const response = await window.converter.copyPath(targetPath);

    if (!response.ok) {
      pushToast('error', response.message || 'Failed to copy path.');
      return;
    }

    pushToast('success', 'Path copied.');
  }

  async function handleCancelJob(jobId) {
    const response = await window.converter.cancelJob(jobId);

    if (!response.ok) {
      pushToast('error', response.message || 'Failed to cancel job.');
    }
  }

  async function handleRetryJobs(jobIds) {
    const retryResponse = await window.converter.retryJobs(jobIds);

    if (!retryResponse.ok) {
      throw new Error(retryResponse.message || 'Failed to retry jobs.');
    }

    if (retryResponse.jobs.length > 0) {
      setJobs((currentJobs) => [
        ...retryResponse.jobs.map((job) => createDraftJob({
          ...job,
          status: 'queued'
        }, settings.defaultFormats)),
        ...currentJobs
      ]);
      pushToast('success', `${buildAggregateMessage(retryResponse.jobs.length, 'job')} re-queued.`);
    }

    if (retryResponse.rejectedFiles.length > 0) {
      pushToast('error', retryResponse.rejectedFiles.map((file) => file.message).join(' '));
    }
  }

  async function handleRetryJob(job) {
    if (!job.jobId) {
      return;
    }

    try {
      await handleRetryJobs([job.jobId]);
    } catch (error) {
      pushToast('error', error.message);
    }
  }

  async function handleRemoveJob(job) {
    if (job.jobId) {
      const response = await window.converter.removeJobs([job.jobId]);

      if (!response.ok) {
        pushToast('error', response.message || 'Failed to remove job.');
        return;
      }

      setRecentJobs((currentJobs) => currentJobs.filter((currentJob) => currentJob.jobId !== job.jobId));
      return;
    }

    setJobs((currentJobs) => currentJobs.filter((currentJob) => currentJob.clientId !== job.clientId));
  }

  async function handleClearFinished() {
    const finishedJobIds = recentJobs
      .filter((job) => TERMINAL_STATUSES.has(job.status))
      .map((job) => job.jobId)
      .filter(Boolean);

    if (finishedJobIds.length === 0) {
      return;
    }

    const response = await window.converter.removeJobs(finishedJobIds);

    if (!response.ok) {
      pushToast('error', response.message || 'Failed to clear finished jobs.');
      return;
    }

    setRecentJobs([]);
  }

  async function handleClearHistory() {
    const response = await window.converter.clearJobHistory();

    if (!response.ok) {
      pushToast('error', response.message || 'Failed to clear recent activity.');
      return;
    }

    setRecentJobs([]);
  }

  function handleRemovePending() {
    const pendingCount = jobs.filter((job) => isReadyJob(job)).length;
    setJobs((currentJobs) => currentJobs.filter((job) => !isReadyJob(job)));

    if (pendingCount > 0) {
      pushToast('success', `${buildAggregateMessage(pendingCount, 'pending file')} removed.`);
    }
  }

  async function handleRetryFailed() {
    const retryableIds = recentJobs
      .filter((job) => job.status === 'failed' || job.status === 'cancelled')
      .map((job) => job.jobId)
      .filter(Boolean);

    if (retryableIds.length === 0) {
      return;
    }

    try {
      await handleRetryJobs(retryableIds);
    } catch (error) {
      pushToast('error', error.message);
    }
  }

  async function handleStartConversion() {
    const draftJobs = jobs.filter((job) => isReadyJob(job));

    if (draftJobs.length === 0) {
      await handleBrowseFiles();
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await window.converter.startConversion({
        files: draftJobs.map((job) => ({
          requestId: job.clientId,
          inputPath: job.inputPath,
          outputFormat: job.outputFormat,
          options: job.optionsOverride || undefined
        })),
        outputDir: selectedOutputDir || null
      });

      if (!response.ok) {
        throw new Error(response.message || 'Failed to queue conversions.');
      }

      setJobs((currentJobs) => {
        const queuedJobsByRequestId = new Map(response.jobs.map((job) => [job.requestId, job]));
        const rejectedJobsByRequestId = new Map(response.rejectedFiles.map((job) => [job.requestId, job]));

        return currentJobs.map((job) => {
          if (!isReadyJob(job)) {
            return job;
          }

          const queuedJob = queuedJobsByRequestId.get(job.clientId);

          if (queuedJob) {
            return {
              ...job,
              ...queuedJob,
              clientId: job.clientId,
              status: 'queued',
              percent: 0,
              timemark: null,
              errorMessage: null
            };
          }

          const rejectedJob = rejectedJobsByRequestId.get(job.clientId);

          if (rejectedJob) {
            forceExpand(job.clientId);
            return {
              ...job,
              status: 'failed',
              errorMessage: rejectedJob.message
            };
          }

          return job;
        });
      });

      if (response.jobs.length > 0) {
        pushToast('success', `${buildAggregateMessage(response.jobs.length, 'conversion')} queued.`);
      }

      if (response.rejectedFiles.length > 0) {
        pushToast('error', response.rejectedFiles.map((job) => job.message).join(' '));
      }
    } catch (error) {
      pushToast('error', error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const readyCount = jobs.filter((job) => isReadyJob(job)).length;
  const queuedCount = jobs.filter((job) => job.status === 'queued').length;
  const convertingCount = jobs.filter((job) => job.status === 'converting').length;
  const doneCount = recentJobs.filter((job) => job.status === 'done').length;
  const failedCount = recentJobs.filter((job) => job.status === 'failed' || job.status === 'cancelled').length;
  const processingCount = queuedCount + convertingCount;

  const primaryActionLabel = useMemo(() => {
    if (isSubmitting) {
      return 'Queueing...';
    }

    if (readyCount > 0) {
      return 'Convert';
    }

    if (processingCount > 0) {
      return 'Converting...';
    }

    return 'Add files';
  }, [isSubmitting, processingCount, readyCount]);

  const isPrimaryActionDisabled = isLoadingSettings || isSubmitting || (processingCount > 0 && readyCount === 0);
  const visibleActiveJobs = queueScope === 'recent' ? [] : jobs;
  const visibleRecentJobs = queueScope === 'active' ? [] : recentJobs;

  const bulkCounts = useMemo(() => {
    const pending = jobs.filter((job) => job.status === 'pending-edit');
    return {
      images: pending.filter((job) => job.detectedType === 'image').length,
      videos: pending.filter((job) => job.detectedType === 'video').length,
      total: pending.length
    };
  }, [jobs]);

  const [estimatedSizes, setEstimatedSizes] = useState({});

  const estimateSignature = useMemo(() => (
    jobs
      .filter((job) => job.status === 'pending-edit' && job.detectedType)
      .map((job) => [
        job.clientId,
        job.outputFormat,
        job.optionsOverride ? JSON.stringify(job.optionsOverride) : 'defaults'
      ].join('|'))
      .join(';')
  ), [jobs]);

  useEffect(() => {
    const items = jobs
      .filter((job) => job.status === 'pending-edit' && job.detectedType)
      .map((job) => ({
        requestId: job.clientId,
        detectedType: job.detectedType,
        duration: job.duration,
        width: job.dimensions?.width,
        height: job.dimensions?.height,
        dimensions: job.dimensions,
        outputFormat: job.outputFormat,
        options: job.optionsOverride || undefined
      }));

    if (items.length === 0 || !window.converter?.estimateSize) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const response = await window.converter.estimateSize(items);
        if (cancelled || !response?.ok) return;
        setEstimatedSizes((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const estimate of response.estimates) {
            if (next[estimate.requestId] !== estimate.bytes) {
              next[estimate.requestId] = estimate.bytes;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      } catch {
        // Silent — estimates are best-effort.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [estimateSignature, settings.defaultOptions]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="app-shell">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <header className="hero-panel animate-in">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.28em]" style={{ color: 'var(--muted-foreground)' }}>
                Offline media workflow
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl" style={{ color: 'var(--foreground)' }}>
                Flux Converter
              </h1>
              <p className="mt-2 text-sm leading-6" style={{ color: 'var(--muted-foreground)' }}>
                Add files, confirm formats, and convert locally with FFmpeg. The queue stays compact by default, while completed work moves into recent activity below.
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
              <div className="summary-strip">
                <span>{readyCount} ready</span>
                <span>{processingCount} processing</span>
                <span>{doneCount} done</span>
              </div>
              <button
                type="button"
                onClick={handleStartConversion}
                disabled={isPrimaryActionDisabled}
                className="primary-button"
              >
                {primaryActionLabel}
              </button>
            </div>
          </div>
        </header>

        <section className="animate-in" style={{ animationDelay: '40ms' }}>
          <DropZone
            hasJobs={jobs.length > 0 || recentJobs.length > 0}
            onBrowse={handleBrowseFiles}
            onFilesSelected={ingestFiles}
          />
        </section>

        <section className="animate-in" style={{ animationDelay: '80ms' }}>
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>Queue</h2>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                Ready items stay at the top. Completed and failed jobs move to recent activity automatically.
              </p>
            </div>
            <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {jobs.length + recentJobs.length} total item{jobs.length + recentJobs.length === 1 ? '' : 's'}
            </span>
          </div>

          <QueueToolbar
            scope={queueScope}
            onScopeChange={setQueueScope}
            readyCount={readyCount}
            recentCount={recentJobs.length}
            failedCount={failedCount}
            onClearFinished={handleClearFinished}
            onRetryFailed={handleRetryFailed}
            onRemovePending={handleRemovePending}
            onClearHistory={handleClearHistory}
          />

          {bulkCounts.total > 0 ? (
            <BulkActionsBar
              scope={bulkScope}
              onScopeChange={setBulkScope}
              counts={bulkCounts}
              formatOptions={supportedFormats}
              onSetFormat={handleBulkSetFormat}
              onSetQuality={handleBulkSetQuality}
              onSetResize={handleBulkSetResize}
              onClearOverrides={handleBulkClearOverrides}
            />
          ) : null}

          <JobList
            activeJobs={visibleActiveJobs}
            recentJobs={visibleRecentJobs}
            expandedRows={expandedRows}
            formatOptions={supportedFormats}
            defaultOptions={settings.defaultOptions || DEFAULT_JOB_OPTIONS}
            estimatedSizes={estimatedSizes}
            onToggleExpanded={toggleExpanded}
            onFormatChange={handleJobFormatChange}
            onOptionsChange={handleJobOptionsChange}
            onOptionsClear={handleJobOptionsClear}
            onRevealOutput={handleRevealOutput}
            onCopyPath={handleCopyPath}
            onCancelJob={handleCancelJob}
            onRetryJob={handleRetryJob}
            onRemoveJob={handleRemoveJob}
          />
        </section>

        <section className="animate-in" style={{ animationDelay: '120ms' }}>
          <button
            type="button"
            onClick={() => setSettingsOpen((open) => !open)}
            className="settings-toggle"
          >
            <span className="flex items-center gap-2">
              <SettingsIcon />
              <span className="font-medium">Conversion defaults</span>
            </span>
            <span className="hidden text-xs sm:flex sm:items-center sm:gap-2" style={{ color: 'var(--muted-foreground)' }}>
              <span>{formatPathSummary(selectedOutputDir || null)}</span>
              <span>•</span>
              <span>Image {settings.defaultFormats.image.toUpperCase()}</span>
              <span>•</span>
              <span>Video {settings.defaultFormats.video.toUpperCase()}</span>
              <span>•</span>
              <span>{settings.maxConcurrent} parallel</span>
              <span>•</span>
              <span>
                {gpuInfo.detecting
                  ? 'Detecting...'
                  : settings.useGpu && gpuInfo.available
                    ? gpuInfo.label
                    : 'CPU'}
              </span>
            </span>
            <ChevronDown open={settingsOpen} />
          </button>

          <div className={`collapse-grid ${settingsOpen ? 'open' : ''}`}>
            <div>
              <div className="settings-panel mt-2">
                <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr_0.8fr_1fr]">
                  <div>
                    <label className="settings-label">Output folder</label>
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={handleOutputDirectoryPick} className="secondary-button">
                        <FolderIcon />
                        {selectedOutputDir ? 'Change folder' : 'Choose folder'}
                      </button>
                      {selectedOutputDir ? (
                        <button type="button" onClick={handleClearOutputDirectory} className="subtle-danger-button">
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs leading-5" style={{ color: 'var(--muted-foreground)' }}>
                      {selectedOutputDir || 'Same as source folder'}
                    </p>
                  </div>

                  <div>
                    <label className="settings-label">Default image format</label>
                    <FormatPicker
                      value={settings.defaultFormats.image}
                      options={supportedFormats.image}
                      onChange={(value) => handleDefaultFormatChange('image', value)}
                    />

                    <label className="settings-label mt-4">Default video format</label>
                    <FormatPicker
                      value={settings.defaultFormats.video}
                      options={supportedFormats.video}
                      onChange={(value) => handleDefaultFormatChange('video', value)}
                    />
                  </div>

                  <div>
                    <label className="settings-label">Parallel jobs</label>
                    <input
                      type="range"
                      min="1"
                      max="4"
                      step="1"
                      value={settings.maxConcurrent}
                      onChange={handleConcurrencyChange}
                    />
                    <div className="mt-2 flex items-center justify-between text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      <span>1</span>
                      <span className="rounded-full px-2 py-0.5" style={{ background: 'var(--muted)', color: 'var(--foreground)' }}>
                        {settings.maxConcurrent}
                      </span>
                      <span>4</span>
                    </div>
                  </div>

                  <div>
                    <label className="settings-label">Hardware acceleration</label>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await persistSettings({ ...settings, useGpu: !settings.useGpu });
                          } catch (err) { pushToast('error', err.message); }
                        }}
                        disabled={gpuInfo.detecting || !gpuInfo.available}
                        className="gpu-toggle"
                        data-active={settings.useGpu && gpuInfo.available}
                        aria-pressed={settings.useGpu && gpuInfo.available}
                      >
                        <span className="gpu-toggle__thumb" />
                      </button>
                      <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                        {gpuInfo.detecting
                          ? 'Detecting compatible GPU...'
                          : !gpuInfo.available
                          ? 'No compatible GPU detected'
                          : settings.useGpu
                            ? gpuInfo.label
                            : 'Disabled (using CPU)'
                        }
                      </span>
                    </div>
                    {gpuInfo.available && !gpuInfo.detecting && (
                      <p className="mt-2 text-xs leading-5" style={{ color: 'var(--muted-foreground)' }}>
                        GPU encoding is significantly faster for video. Images always use CPU.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>
                      Encoding options
                    </h3>
                    <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      Global defaults applied to every conversion. Individual files can override these later.
                    </p>
                  </div>
                  <OptionsPanel
                    value={settings.defaultOptions || DEFAULT_JOB_OPTIONS}
                    onChange={handleDefaultOptionsChange}
                    mediaType="both"
                    showTrimCrop={false}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="toast-viewport">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            type={toast.type}
            message={toast.message}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </main>
  );
}
