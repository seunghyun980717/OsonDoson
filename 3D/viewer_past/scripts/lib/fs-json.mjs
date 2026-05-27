import fs from 'node:fs/promises';

export async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function clearDirectory(dirPath) {
  await fs.rm(dirPath, { recursive: true, force: true });
  await ensureDirectory(dirPath);
}

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

export async function writeJsonFile(filePath, value, { space = 2, trailingNewline = true } = {}) {
  const text = JSON.stringify(value, null, space);
  await fs.writeFile(filePath, trailingNewline ? `${text}\n` : text, 'utf8');
}
