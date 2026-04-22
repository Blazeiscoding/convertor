const path = require('node:path');
const { app, BrowserWindow, protocol, net } = require('electron/main');
const { registerIpcHandlers } = require('./ipcHandlers');

// A custom standard scheme that lets the renderer <video> stream arbitrary
// local media files (for the trim/crop editor preview) without disabling
// webSecurity on the BrowserWindow.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
      bypassCSP: true,
      corsEnabled: true,
    },
  },
]);

function registerFluxMediaProtocol() {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== 'flux-media') {
        return new Response(null, { status: 404 });
      }
      const encoded = url.pathname.replace(/^\//, '');
      const decodedPath = decodeURIComponent(encoded);
      const fileUrl = `file:///${decodedPath.replace(/\\/g, '/')}`;
      return net.fetch(fileUrl, { bypassCustomProtocolHandlers: true });
    } catch (error) {
      console.warn('[protocol] app:// fetch failed:', error);
      return new Response(null, { status: 500 });
    }
  });
}

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

  registerFluxMediaProtocol();
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
