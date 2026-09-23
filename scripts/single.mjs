// Nachbearbeitung des Einzeldatei-Builds:
// - berechnet SHA-256-Hashes aller Inline-<script>- und <style>-Blöcke,
// - setzt eine strikte CSP (ohne 'unsafe-inline') als erstes Element in <head>,
// - benennt die Datei in zwiesprache.html um.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { buildCsp, cspMetaTag } from '../build/csp.mjs';

const DIR = 'dist-single';
const src = `${DIR}/index.html`;
if (!existsSync(src)) {
  console.error(`${src} fehlt – zuerst "vite build --mode single" ausführen.`);
  process.exit(1);
}
let html = readFileSync(src, 'utf8');

const hash = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const scriptHashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .filter((m) => !/\bsrc\s*=/.test(m[0].slice(0, m[0].indexOf('>'))))
  .map((m) => hash(m[1]));
const styleHashes = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => hash(m[1]));

if (/<script\b[^>]*\bsrc=|<link\b[^>]*rel="stylesheet"/i.test(html)) {
  console.error('Einzeldatei enthält noch externe Skripte/Styles.');
  process.exit(1);
}

const csp = buildCsp({
  'script-src': scriptHashes.length ? scriptHashes : ["'none'"],
  'style-src': styleHashes.length ? styleHashes : ["'none'"],
});
html = html.replace(/(<meta charset="utf-8" \/>)/i, `$1\n    ${cspMetaTag(csp)}`);
if (!html.includes("Content-Security-Policy")) {
  console.error("CSP konnte nicht eingefügt werden.");
  process.exit(1);
}
writeFileSync(src, html);
renameSync(src, `${DIR}/zwiesprache.html`);
console.log(`Einzeldatei: ${DIR}/zwiesprache.html (${scriptHashes.length} Skript-, ${styleHashes.length} Style-Hash(es))`);
