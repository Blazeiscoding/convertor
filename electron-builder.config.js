module.exports = {
  appId: 'com.nikhilrathore.fluxconverter',
  productName: 'Flux Converter',
  directories: {
    buildResources: 'build',
    output: 'release'
  },
  files: [
    'src/main/**/*',
    'src/preload/**/*',
    'dist/renderer/**/*',
    'package.json'
  ],
  extraMetadata: {
    main: 'src/main/index.js'
  },
  asarUnpack: [
    '**/node_modules/ffmpeg-static/**/*',
    '**/node_modules/ffprobe-static/**/*'
  ],
  // Config covers Windows, macOS, and Linux packaging.
  // Actual native artifacts still require building on their respective OS environments.
  win: {
    target: ['nsis'],
    icon: 'node_modules/app-builder-lib/templates/icons/proton-native/proton-native.ico',
    signAndEditExecutable: false,
    verifyUpdateCodeSignature: false
  },
  mac: {
    target: ['dmg'],
    icon: 'build/icon.icns',
    category: 'public.app-category.utilities'
  },
  linux: {
    target: ['AppImage'],
    icon: 'build/icon.png',
    category: 'Utility'
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'node_modules/app-builder-lib/templates/icons/proton-native/proton-native.ico',
    uninstallerIcon: 'node_modules/app-builder-lib/templates/icons/proton-native/proton-native.ico',
    installerHeaderIcon: 'node_modules/app-builder-lib/templates/icons/proton-native/proton-native.ico'
  }
};
