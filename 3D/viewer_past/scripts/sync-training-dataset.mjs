import fs from 'node:fs/promises';
import path from 'node:path';
import {
  clearDirectory,
  ensureDirectory,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from './lib/fs-json.mjs';
import { replaceFrameSequenceKey } from './lib/frame-names.mjs';
import {
  manifestPath,
  publicFrameRoot,
  publicVideoRoot,
  sampleManifestPath,
  trainingRoot,
} from './lib/paths.mjs';

const allowedCategories = new Set(
  (process.env.THREE_D_TRAINING_DATA_CATEGORIES ?? process.env.TRAINING_DATA_CATEGORIES ?? 'WORD,SEN')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean),
);

const datasetSpecs = [
  {
    category: 'WORD',
    videoRoot: path.join(trainingRoot, '[원천]01_real_word_video', '01'),
    keypointRoot: path.join(trainingRoot, '[라벨]01_real_word_keypoint', '01'),
  },
  {
    category: 'SEN',
    videoRoot: path.join(trainingRoot, '[원천]01_real_sen_video', '01'),
    keypointRoot: path.join(trainingRoot, '[라벨]01_real_sen_keypoint', '01'),
  },
].filter((spec) => allowedCategories.has(spec.category));

function compareNatural(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

async function listDirectories(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareNatural);
}

async function listFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort(compareNatural);
}

function extractSequenceId(category, sequenceKey) {
  const match = sequenceKey.match(new RegExp(`${category}(\\d+)_`, 'i'));
  return match?.[1] ?? sequenceKey;
}

async function copyFile(sourcePath, destinationPath) {
  await ensureDirectory(path.dirname(destinationPath));
  await fs.copyFile(sourcePath, destinationPath);
}

async function copyDirectory(sourceDir, destinationDir) {
  await fs.cp(sourceDir, destinationDir, { recursive: true, force: true });
}

async function rewriteFrameFiles(sequence) {
  const destinationDir = path.join(publicFrameRoot, sequence.key);

  for (const fileName of sequence.files) {
    const sourceFileName = replaceFrameSequenceKey(fileName, sequence.key, sequence.sourceKey);

    if (sourceFileName === fileName) {
      continue;
    }

    const sourcePath = path.join(destinationDir, sourceFileName);
    const destinationPath = path.join(destinationDir, fileName);
    const json = await readJsonFile(sourcePath);

    await writeJsonFile(destinationPath, json, { space: undefined });
    await fs.rm(sourcePath, { force: true });
  }
}

async function collectSequencesForSpec(spec) {
  if (!(await pathExists(spec.videoRoot)) || !(await pathExists(spec.keypointRoot))) {
    return [];
  }

  const sequenceDirs = (await listDirectories(spec.keypointRoot))
    .filter((name) => name.endsWith('_F'));

  const sequences = [];

  for (const sourceKey of sequenceDirs) {
    const frameSourceDir = path.join(spec.keypointRoot, sourceKey);
    const frameFiles = (await listFiles(frameSourceDir))
      .filter((name) => name.endsWith('.json'));

    if (!frameFiles.length) {
      continue;
    }

    const videoSourcePath = path.join(spec.videoRoot, `${sourceKey}.mp4`);

    if (!(await pathExists(videoSourcePath))) {
      continue;
    }

    const shortId = extractSequenceId(spec.category, sourceKey);
    const publicKey = `${spec.category}_${sourceKey}`;

    await copyFile(videoSourcePath, path.join(publicVideoRoot, `${publicKey}.mp4`));
    await copyDirectory(frameSourceDir, path.join(publicFrameRoot, publicKey));

    sequences.push({
      id: `${spec.category}-${shortId}`,
      label: `${spec.category} ${shortId}`,
      category: spec.category,
      sourceKey,
      key: publicKey,
      video: `/videos/sequences/${publicKey}.mp4`,
      frameDir: `/data/sequences/${publicKey}`,
      files: frameFiles.map((fileName) => fileName.replace(sourceKey, publicKey)),
    });
  }

  for (const sequence of sequences) {
    await rewriteFrameFiles(sequence);
  }
  return sequences;
}

async function buildManifest() {
  const collected = await Promise.all(datasetSpecs.map((spec) => collectSequencesForSpec(spec)));
  const sequences = collected
    .flat()
    .sort((a, b) => compareNatural(a.label, b.label))
    .map(({ sourceKey, ...sequence }) => sequence);

  return { sequences };
}

async function main() {
  await clearDirectory(publicVideoRoot);
  await clearDirectory(publicFrameRoot);

  const manifest = await buildManifest();

  await writeJsonFile(manifestPath, manifest);

  const sampleFiles = manifest.sequences[0]?.files ?? [];
  await writeJsonFile(sampleManifestPath, { files: sampleFiles });

  console.log(`Synced ${manifest.sequences.length} training sequences from ${trainingRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
