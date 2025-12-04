import fs from 'fs';
import path from 'path';

const srcDir = path.join(process.cwd(), 'dist');
const destDir = path.join(process.cwd(), 'manifest', 'src', 'js');

fs.rmSync(destDir, { recursive: true, force: true });
fs.mkdirSync(destDir, { recursive: true });
for (const file of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}
