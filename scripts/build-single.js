/**
 * scripts/build-single.js — builds dist/vbbt.html, a single HTML file with all
 * app code and styles inlined.   Run:  node scripts/build-single.js
 *
 * How it works (no bundler needed): each ES module is wrapped in a function
 * scope that returns its exports; each `import {a, b} from './x.js'` becomes
 * `const {a, b} = <module x>`. Modules are emitted in dependency order.
 *
 * The large MediaPipe files (~30 MB) are NOT inlined. The single file loads them
 * from ../vendor/mediapipe/ (works when dist/ sits next to vendor/, e.g. on the
 * hosted site), otherwise from the jsDelivr CDN as a fallback (needs internet).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const modules = new Map();   // normalised path -> { id, code, deps }
let counter = 0;

function load(rel) {
  const norm = path.normalize(rel).replace(/\\/g, '/');
  if (modules.has(norm)) return modules.get(norm);
  const entry = { id: `__m${counter++}`, path: norm, code: '', deps: [] };
  modules.set(norm, entry);
  let src = read(norm);
  if (norm === 'config.js') src = src.replace("MEDIAPIPE_LOCAL = './vendor/mediapipe/'", "MEDIAPIPE_LOCAL = '../vendor/mediapipe/'");

  const exportsList = [];
  // import { a, b as c } from './x.js';   (may span several lines)
  src = src.replace(/^import\s*\{([\s\S]*?)\}\s*from\s*['"](.+?)['"];?[ \t]*$/gm, (_, names, from) => {
    const dep = load(path.join(path.dirname(norm), from));
    entry.deps.push(dep);
    const binds = names.split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${binds.join(', ')} } = ${dep.id};`;
  });
  if (/^import\s/m.test(src)) throw new Error(`Unsupported import form in ${norm}`);
  // export const/let/function/class/async function NAME
  src = src.replace(/^export\s+(const|let|function|class|async function)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    exportsList.push(name);
    return `${kind} ${name}`;
  });
  if (/^export\s/m.test(src)) throw new Error(`Unsupported export form in ${norm}`);
  entry.code = src;
  entry.exports = exportsList;
  return entry;
}

load('app.js');

// Emit in dependency order (depth-first, dependencies first).
const order = []; const seen = new Set();
(function visit(list) {
  for (const m of list) {
    if (seen.has(m.path)) continue;
    seen.add(m.path);
    visit(m.deps);
    order.push(m);
  }
})([...modules.values()]);

const js = order.map((m) => `// ===== ${m.path} =====\nconst ${m.id} = (() => {\n${m.code}\nreturn { ${m.exports.join(', ')} };\n})();\n`).join('\n');

let html = read('index.html');
const css = read('styles.css');
html = html.replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`);
const safeJs = js.replace(/<\/script/gi, '<\\/script');
html = html.replace('<script type="module" src="app.js"></script>',
  `<script>window.VBBT_SINGLE_FILE = true;</script>\n<script type="module">\n${safeJs}\n</script>`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'vbbt.html'), html);
console.log(`dist/vbbt.html written (${(html.length / 1024).toFixed(0)} KB, ${order.length} modules: ${order.map((m) => m.path).join(', ')})`);
