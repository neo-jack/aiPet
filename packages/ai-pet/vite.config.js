import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [{
  name: 'pet-paper-asset', enforce: 'pre',
  load(id) {
    if (!id.replaceAll('\\', '/').endsWith('/assets/paper.webp?url')) return;
    const reference = this.emitFile({ type: 'asset', name: 'paper.webp', source: readFileSync(id.slice(0, -4)) });
    return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
  }
}, tailwindcss()], build: {
  lib: { entry: {index:'src/index.ts',three:'src/three.ts',replyFormat:'src/replyFormat.ts',aiChat:'src/aiChat.ts',siteCards:'src/siteCards.ts'}, formats:['es'], fileName:(_,name)=>`${name}.js`, cssFileName:'ai-pet' },
  rollupOptions: { external: id => !id.startsWith('.') && !id.startsWith('/') && !/^[A-Za-z]:/.test(id) }
} });
