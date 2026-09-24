import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

const CACHE_VERSION_TOKEN = '__PASSENGER_CACHE_VERSION__';

function injectPassengerCacheVersion(): Plugin {
  return {
    name: 'inject-passenger-cache-version',
    apply: 'build',
    enforce: 'post',
    async writeBundle(options) {
      if (!options.dir) {
        throw new Error('Passenger service worker build requires an output directory.');
      }

      const outputDirectory = path.resolve(options.dir);
      const files: string[] = [];
      const collectFiles = async (directory: string) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const entryPath = path.join(directory, entry.name);
          if (entry.isDirectory()) {
            await collectFiles(entryPath);
          } else if (entry.isFile()) {
            files.push(entryPath);
          }
        }
      };
      await collectFiles(outputDirectory);
      files.sort((left, right) => left.localeCompare(right));

      const workerPath = path.join(outputDirectory, 'sw.js');
      const worker = await readFile(workerPath, 'utf8');
      if (!worker.includes(CACHE_VERSION_TOKEN)) {
        throw new Error('Passenger service worker cache version token is missing.');
      }

      const hash = createHash('sha256');
      for (const file of files) {
        hash.update(path.relative(outputDirectory, file));
        hash.update('\0');
        hash.update(await readFile(file));
        hash.update('\0');
      }
      const version = hash.digest('hex').slice(0, 16);
      await writeFile(workerPath, worker.replaceAll(CACHE_VERSION_TOKEN, version));
    },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    'import.meta.env.VITE_MAPTILER_API_KEY': JSON.stringify(
      process.env.MAPTILER_API_KEY ?? '',
    ),
  },
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    injectPassengerCacheVersion(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
