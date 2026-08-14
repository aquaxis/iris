import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// The IRIS parser is consumed straight from the iris2sv workspace. It has no
// Node-only imports, so it bundles for the browser as it stands, and the tool
// needs no server to parse a design.
export default defineConfig({
  resolve: {
    alias: {
      '@iris2sv/core': resolve(__dirname, '../iris2sv/packages/core/dist/index.js'),
    },
  },
  test: {
    environment: 'node',
  },
});
