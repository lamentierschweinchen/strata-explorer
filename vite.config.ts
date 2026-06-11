import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: {
        // The visualization. ?dj overlays the audio studio on it (code-split — the audio
        // chunks load only when the flag is present).
        main: path.resolve(__dirname, 'index.html'),
        // The standalone audio studio / track-maker (shareable mix links live here).
        studio: path.resolve(__dirname, 'studio.html'),
      },
    },
  },
});
