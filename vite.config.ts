import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { buildCsp, cspMetaTag } from './build/csp.mjs';

/** Fügt im Production-Build die CSP als erstes Element in <head> ein (Mehrdatei-Build). */
function cspPlugin(): Plugin {
  return {
    name: 'zwiesprache-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/(<meta charset="utf-8" \/>)/i, `$1\n    ${cspMetaTag(buildCsp())}`);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: [preact({ prerender: { enabled: false } }), ...(single ? [viteSingleFile({ removeViteModuleLoader: true })] : [cspPlugin()])],
    build: {
      outDir: single ? 'dist-single' : 'dist',
      emptyOutDir: true,
      target: ['es2022', 'chrome111', 'edge111', 'firefox113', 'safari16.4'],
      sourcemap: false,
      modulePreload: { polyfill: false },
      reportCompressedSize: false,
    },
    server: {
      host: '127.0.0.1',
    },
  };
});
