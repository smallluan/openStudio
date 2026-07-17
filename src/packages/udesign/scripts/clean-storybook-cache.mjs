import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = join(packageRoot, 'node_modules', '.cache', 'storybook');

rmSync(cacheDir, { recursive: true, force: true });
console.log(`[storybook:clean] removed ${cacheDir}`);
