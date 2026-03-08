import fs from 'node:fs';
import path from 'node:path';

const appRoot = path.resolve(import.meta.dirname, '..');
const localesRoot = path.join(appRoot, 'public', 'locales');
const newKey = '云端书籍';
const newValue = '云端书籍';
const oldKeys = ['云端书籍（以云端目录为准）', '云端书籍。以云端目录为准'];

const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

const updateJsonFile = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(raw);
  if (!isObject(json)) return false;

  let changed = false;
  for (const k of oldKeys) {
    if (Object.prototype.hasOwnProperty.call(json, k)) {
      delete json[k];
      changed = true;
    }
  }
  if (json[newKey] !== newValue) {
    json[newKey] = newValue;
    changed = true;
  }

  if (!changed) return false;
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  return true;
};

const languages = fs
  .readdirSync(localesRoot, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

let touched = 0;
for (const lng of languages) {
  const filePath = path.join(localesRoot, lng, 'translation.json');
  if (!fs.existsSync(filePath)) continue;
  if (updateJsonFile(filePath)) touched += 1;
}

process.stdout.write(`updated ${touched} locale files\n`);

