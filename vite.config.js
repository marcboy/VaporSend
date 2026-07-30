import { defineConfig } from 'vite';

export default defineConfig({
  base: '/VaporSend/', // Set base path for GitHub Pages compatibility
  server: {
    host: true, // Listen on all local IPs so mobile devices can access the dev server on local Wi-Fi if they want to load it
    port: 3000
  }
});
