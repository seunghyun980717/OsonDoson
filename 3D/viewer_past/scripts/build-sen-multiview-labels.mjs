import path from 'node:path';
import {
  HAND_SIDES,
  CORRECTION_EPSILON,
  computeCollisionLabel,
} from '../src/lib/sen-correction.js';
import {
  ensureDirectory,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from './lib/fs-json.mjs';
import { frameNumberFromName } from './lib/frame-names.mjs';
import { sourceViewKey } from './lib/sequence-paths.mjs';
import {
  generatedRoot,
  manifestPath,
  trainingRoot,
} from './lib/paths.mjs';

const outputDir = generatedRoot;
const outputPath = path.join(outputDir, 'sen-multiview-labels.json');
const sourceKeypointRoot = path.join(trainingRoot, '[라벨]01_real_sen_keypoint', '01');
const views = ['F', 'L', 'R', 'U', 'D'];

function getSourceKey(sequenceKey) {
  return sequenceKey.replace(/^SEN_/, '').replace(/^WORD_/, '');
}

async function readFrameForView(sourceKey, view, fileName) {
  const viewKey = sourceViewKey(sourceKey, view);
  const dirPath = path.join(sourceKeypointRoot, viewKey);
  const resolvedFile = fileName
    .replace(/^SEN_/, '')
    .replace(/^WORD_/, '')
    .replace(sourceKey, viewKey);
  const filePath = path.join(dirPath, resolvedFile);

  if (!(await pathExists(filePath))) {
    return null;
  }

  return readJsonFile(filePath);
}

async function buildLabels() {
  const manifest = await readJsonFile(manifestPath);
  const sequences = (manifest.sequences ?? []).filter((sequence) => sequence.category === 'SEN');
  const rows = [];
  const sequencesSummary = {};
  let skippedFrames = 0;

  for (const sequence of sequences) {
    const sourceKey = getSourceKey(sequence.key);
    let sequenceRowCount = 0;

    for (const fileName of sequence.files) {
      const frameNumber = frameNumberFromName(fileName);
      const viewFrames = {};

      for (const view of views) {
        viewFrames[view] = await readFrameForView(sourceKey, view, fileName);
      }

      if (views.some((view) => !viewFrames[view])) {
        skippedFrames += 1;
        continue;
      }

      for (const handSide of HAND_SIDES) {
        const label = computeCollisionLabel(viewFrames.F, viewFrames, handSide, {
          sequenceId: sequence.id,
          frameNumber,
          epsilon: CORRECTION_EPSILON,
        });

        if (!label) {
          continue;
        }

        rows.push(label);
        sequenceRowCount += 1;
      }
    }

    sequencesSummary[sequence.id] = {
      labelRows: sequenceRowCount,
      frames: sequence.files.length,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    epsilon: CORRECTION_EPSILON,
    skippedFrames,
    rows,
    sequences: sequencesSummary,
  };
}

async function main() {
  await ensureDirectory(outputDir);
  const labels = await buildLabels();
  await writeJsonFile(outputPath, labels);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
