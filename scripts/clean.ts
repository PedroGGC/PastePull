import { rimraf } from 'rimraf';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '..', 'dist');

async function clean(): Promise<void> {
  try {
    await rimraf(distPath);
    console.log('Dist folder cleaned successfully');
  } catch (err) {
    console.error('Error cleaning dist folder:', err);
    process.exit(1);
  }
}

clean();