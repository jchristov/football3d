import { defineConfig } from 'vite';
import { relayPlugin } from './server/relay.js';

export default defineConfig({
  base: './',
  plugins: [relayPlugin()], // rooms for online play on the same network (see server/relay.js)
  server: { host: true, port: 5100 },
  preview: { port: 5100 },
  build: { chunkSizeWarningLimit: 900 },
});
