import { spawn, spawnSync } from 'node:child_process';

const modes = ['welcome', 'map', 'next-stop', 'weather', 'traffic', 'daf', 'jewish-calendar', 'announcements', 'safety'];
const viewports = [[1366, 768], [1024, 768], [768, 1024]];
const port = 4179;
const server = spawn('pnpm', ['exec', 'vite', '--config', 'vite.config.ts', '--host', '127.0.0.1', '--port', String(port)], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: String(port), BASE_PATH: '/' },
  stdio: 'ignore',
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
try {
  for (let attempt = 0; attempt < 50; attempt++) {
    const ready = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.ok).catch(() => false);
    if (ready) break;
    if (attempt === 49) throw new Error('Layout test server did not start.');
    await sleep(100);
  }

  const failures = [];
  for (const [width, height] of viewports) {
    for (const mode of modes) {
      const result = spawnSync('chromium', [
        '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        `--window-size=${width},${height}`, '--virtual-time-budget=1200', '--dump-dom',
        `http://127.0.0.1:${port}/__layout-test/${mode}`,
      ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
      const match = result.stdout.match(/data-layout-result[^>]*>([^<]+)</);
      const report = match ? JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')) : null;
      if (!report || report.checked < 5 || report.clipped.length) {
        failures.push({ viewport: `${width}x${height}`, mode, report, stderr: result.stderr.slice(-300) });
      }
    }
  }
  if (failures.length) {
    console.error(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`Passenger layout check passed: ${modes.length} views across ${viewports.length} viewports.`);
  }
} finally {
  server.kill('SIGTERM');
}