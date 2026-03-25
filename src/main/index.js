const path = require('node:path');
const { app, BrowserWindow } = require('electron/main');
const { registerIpcHandlers } = require('./ipcHandlers');

let mainWindow = null;
let services = null;

function getRendererEntry() {
  if (!app.isPackaged) {
    return process.env.ELECTRON_START_URL || 'http://localhost:5173/public/index.html';
  }

  return path.join(app.getAppPath(), 'dist', 'renderer', 'public', 'index.html');
}

function createWindow() {
  const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#060816',
    title: 'Flux',
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (!app.isPackaged) {
    mainWindow.loadURL(getRendererEntry()).catch((error) => {
      console.error('Failed to load renderer URL:', error);
    });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  mainWindow.loadFile(getRendererEntry()).catch((error) => {
    console.error('Failed to load renderer file:', error);
  });
}

async function bootstrap() {
  await app.whenReady();

  createWindow();
  services = registerIpcHandlers({
    getMainWindow: () => mainWindow
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (services?.dispose) {
    await services.dispose();
  }
});

bootstrap().catch((error) => {
  console.error('Application bootstrap failed:', error);
  app.quit();
});
