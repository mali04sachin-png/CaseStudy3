// Bundles the serverless entry into a single self-contained ESM file
// (api/index.mjs). The banner injects a real `require` so bundled CommonJS
// dependencies (jsonwebtoken → jws → safe-buffer) can require Node built-ins
// like "buffer" at runtime without esbuild's throwing shim.

import { build } from 'esbuild';

await build({
  entryPoints: ['api/_entry.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'api/index.mjs',
  external: ['pg-native', 'cloudflare:sockets'],
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});
