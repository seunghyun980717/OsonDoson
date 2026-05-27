import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsLibDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = path.resolve(scriptsLibDir, '..', '..');

loadEnvFiles([
  path.resolve(defaultProjectRoot, '..', '.env'),
  path.resolve(defaultProjectRoot, '.env'),
]);

function resolvePath(value, baseDir = defaultProjectRoot) {
  if (!value) {
    return null;
  }

  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

export const projectRoot = resolvePath(process.env.THREE_D_PROJECT_ROOT) ?? defaultProjectRoot;
export const publicRoot = resolvePath(process.env.THREE_D_PUBLIC_ROOT, projectRoot) ??
  path.join(projectRoot, 'public');
export const publicDataRoot = resolvePath(process.env.THREE_D_PUBLIC_DATA_ROOT, projectRoot) ??
  path.join(publicRoot, 'data');
export const publicVideoRoot = resolvePath(process.env.THREE_D_PUBLIC_VIDEO_ROOT, projectRoot) ??
  path.join(publicRoot, 'videos', 'sequences');
export const publicFrameRoot = resolvePath(process.env.THREE_D_PUBLIC_FRAME_ROOT, projectRoot) ??
  path.join(publicDataRoot, 'sequences');
export const generatedRoot = resolvePath(process.env.THREE_D_GENERATED_ROOT, projectRoot) ??
  path.join(projectRoot, 'generated');

export const manifestPath = resolvePath(process.env.THREE_D_SEQUENCE_MANIFEST, projectRoot) ??
  path.join(publicDataRoot, 'sequence-manifest.json');
export const sampleManifestPath = resolvePath(process.env.THREE_D_SAMPLE_SEQUENCE_MANIFEST, projectRoot) ??
  path.join(publicDataRoot, 'sample-sequence-manifest.json');

export const trainingRoot = resolvePath(
  process.env.THREE_D_TRAINING_DATA_ROOT ?? process.env.TRAINING_DATA_ROOT,
  projectRoot,
) ?? path.resolve(projectRoot, '..', '..', '수어 영상', '1.Training');

export const multiviewLabelRoot = resolvePath(
  process.env.THREE_D_MULTIVIEW_LABEL_ROOT ?? process.env.MULTIVIEW_LABEL_ROOT,
  projectRoot,
) ?? path.resolve(projectRoot, '..', '..', '데이터세트', '수어 영상', '2.Validation', 'WORD', 'keypoint', '03');

export function resolveProjectPath(value) {
  return resolvePath(value, projectRoot);
}

export function publicDataUrlForPath(targetPath) {
  const relative = path.relative(publicDataRoot, targetPath);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return `/data/${relative.split(path.sep).join('/')}`;
}

function loadEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();

      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');

      if (separatorIndex === -1) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
