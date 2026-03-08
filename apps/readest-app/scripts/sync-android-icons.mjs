import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const appRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(appRoot, 'src-tauri', 'icons', 'android');
const targetDir = path.join(appRoot, 'src-tauri', 'gen', 'android', 'app', 'src', 'main', 'res');

if (!existsSync(sourceDir)) {
  throw new Error(`Android icon source directory not found: ${sourceDir}`);
}

if (!existsSync(targetDir)) {
  throw new Error(`Generated Android resource directory not found: ${targetDir}`);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const copyFileWithRetry = (sourcePath, targetPath, attempts = 5) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(targetPath, { force: true });
      copyFileSync(sourcePath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        sleep(150 * attempt);
      }
    }
  }

  throw lastError;
};

const syncDirectory = (sourcePath, targetPath) => {
  mkdirSync(targetPath, { recursive: true });

  for (const entry of readdirSync(sourcePath)) {
    const sourceEntryPath = path.join(sourcePath, entry);
    const targetEntryPath = path.join(targetPath, entry);
    const stats = statSync(sourceEntryPath);

    if (stats.isDirectory()) {
      syncDirectory(sourceEntryPath, targetEntryPath);
      continue;
    }

    copyFileWithRetry(sourceEntryPath, targetEntryPath);
  }
};

syncDirectory(sourceDir, targetDir);

console.log(`Synced Android launcher icons from ${sourceDir} to ${targetDir}`);