// Gibt SHA-256 aller Build-Artefakte aus und schreibt SHA256SUMS ins Ausgabeverzeichnis.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const dir = process.argv[2] ?? 'dist';

function walk(d) {
  return readdirSync(d)
    .sort()
    .flatMap((name) => {
      const p = join(d, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

const files = walk(dir).filter((f) => !f.endsWith('SHA256SUMS'));
const lines = files.map((f) => `${createHash('sha256').update(readFileSync(f)).digest('hex')}  ${relative(dir, f).split('\\').join('/')}`);
writeFileSync(join(dir, 'SHA256SUMS'), lines.join('\n') + '\n');
console.log(`\nSHA-256 der Artefakte in ${dir}/:`);
for (const l of lines) console.log('  ' + l);
console.log(`(gespeichert in ${dir}/SHA256SUMS)\n`);
