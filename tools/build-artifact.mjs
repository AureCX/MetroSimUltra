// Packs the production build into one self-contained HTML file (all JS/CSS inline),
// suitable for hosting as a single-page artifact or opening straight from disk.
import fs from 'node:fs';
import path from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => fs.readFileSync(path.join(dist, m[1]), 'utf8')).join('\n');
const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => fs.readFileSync(path.join(dist, m[1]), 'utf8')).join('\n');
const safeJs = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
const out = `<title>Metro Driver</title>
<style>${css}</style>
${body}
<script type="module">${safeJs}</script>
`;
const file = path.join(dist, 'metro-driver.html');
fs.writeFileSync(file, out);
console.log(`${file} ${(out.length / 1024).toFixed(0)} KB`);
