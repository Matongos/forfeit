import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('C:/Users/User/Downloads/Forfeit.html', 'utf8');
const grab = (type) => {
  const m = html.match(new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`));
  return m ? JSON.parse(m[1]) : null;
};
const template = grab('template');
const manifest = grab('manifest');
const out = 'C:/Users/User/Desktop/MASTER/forfeit/scratch-design.html';
writeFileSync(out, typeof template === 'string' ? template : JSON.stringify(template, null, 1));
console.log('template type:', typeof template, 'length:', (typeof template === 'string' ? template : JSON.stringify(template)).length);
if (manifest) {
  const entries = Object.entries(manifest);
  console.log('manifest entries:', entries.length);
  for (const [k, v] of entries.slice(0, 30)) {
    const desc = typeof v === 'string' ? `${v.slice(0, 60)}… (${v.length})` : JSON.stringify(v).slice(0, 120);
    console.log(' ', k, '->', desc);
  }
}
