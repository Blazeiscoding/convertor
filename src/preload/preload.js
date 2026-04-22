const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, listener) {
  const wrappedListener = (_event, payload) => {
    listener(payload);
  };

  ipcRenderer.on(channel, wrappedListener);

  return () => {
    ipcRenderer.removeListener(channel, wrappedListener);
  };
}

contextBridge.exposeInMainWorld('converter', {
  probeMedia: (inputPaths) => ipcRenderer.invoke('media:probe', { inputPaths }),
  estimateSize: (items) => ipcRenderer.invoke('media:estimateSize', { items }),
  getThumbnail: (inputPath, detectedType) => ipcRenderer.invoke('media:thumbnail', { inputPath, detectedType }),
  startConversion: (payload) => ipcRenderer.invoke('convert:start', payload),
  cancelJob: (jobId) => ipcRenderer.invoke('convert:cancel', { jobId }),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFiles'),
  openInFolder: (targetPath) => ipcRenderer.invoke('shell:showItemInFolder', { targetPath }),
  openPath: (targetPath) => ipcRenderer.invoke('shell:openPath', { targetPath }),
  copyPath: (targetPath) => ipcRenderer.invoke('shell:copyPath', { targetPath }),
  getJobHistory: () => ipcRenderer.invoke('jobs:history:get'),
  clearJobHistory: () => ipcRenderer.invoke('jobs:history:clear'),
  removeJobs: (jobIds) => ipcRenderer.invoke('jobs:remove', { jobIds }),
  retryJobs: (jobIds) => ipcRenderer.invoke('jobs:retry', { jobIds }),
  reorderJobs: (orderedIds) => ipcRenderer.invoke('jobs:reorder', { orderedIds }),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload),
  onGpuStatus: (listener) => subscribe('gpu:status', listener),
  onProgress: (listener) => subscribe('convert:progress', listener),
  onDone: (listener) => subscribe('convert:done', listener),
  onError: (listener) => subscribe('convert:error', listener),
  onStatus: (listener) => subscribe('convert:status', listener)
});
