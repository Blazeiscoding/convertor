const path = require('node:path');
const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react').default;
const tailwindcss = require('@tailwindcss/vite').default;

module.exports = defineConfig({
  root: '.',
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, 'public/index.html')
      }
    }
  }
});
