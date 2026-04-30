import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..');
const assets: Array<[from: string, to: string]> = [
  ['src/renderer/index.html', 'dist/renderer/index.html'],
  ['src/renderer/styles.css', 'dist/renderer/styles.css'],
];

for (const [from, to] of assets) {
  const sourcePath = path.join(projectRoot, from);
  const targetPath = path.join(projectRoot, to);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}
