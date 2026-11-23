// Copia o motor de leitura de comprovativos (tesseract.js, Apache-2.0) para public/ocr, para ser servido pelo próprio
// site (sem depender de CDN para o código). A língua (por.traineddata) vem do CDN do tessdata na 1.ª leitura.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('public/ocr', { recursive: true });
copyFileSync('node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js');
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js']) copyFileSync(`node_modules/tesseract.js-core/${f}`, `public/ocr/${f}`);
console.log('motor de leitura copiado para public/ocr');
