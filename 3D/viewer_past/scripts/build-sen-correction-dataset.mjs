import path from 'node:path';
import {
  computeArmCorrectionFeaturesFromFrame,
  featureVectorFromMetrics,
} from '../src/lib/sen-correction.js';
import {
  ensureDirectory,
  readJsonFile,
  writeJsonFile,
} from './lib/fs-json.mjs';
import { frameNumberFromName } from './lib/frame-names.mjs';
import { publicSequenceFramePath } from './lib/sequence-paths.mjs';
import {
  generatedRoot,
  manifestPath,
  publicDataRoot,
} from './lib/paths.mjs';

const labelsPath = path.join(generatedRoot, 'sen-multiview-labels.json');
const outputDir = generatedRoot;
const outputPath = path.join(outputDir, 'sen-correction-dataset.json');

async function buildDataset() {
  const manifest = await readJsonFile(manifestPath);
  const labels = await readJsonFile(labelsPath);
  const labelMap = new Map(
    labels.rows.map((row) => [`${row.sequenceId}:${row.frameNumber}:${row.handSide}`, row]),
  );
  const sequences = (manifest.sequences ?? []).filter((sequence) => sequence.category === 'SEN');
  const rows = [];

  for (const sequence of sequences) {
    for (const fileName of sequence.files) {
      const frameNumber = frameNumberFromName(fileName);
      const framePath = publicSequenceFramePath({ publicDataRoot }, sequence, fileName);
      const frameData = await readJsonFile(framePath);

      for (const handSide of ['left', 'right']) {
        const label = labelMap.get(`${sequence.id}:${frameNumber}:${handSide}`);

        if (!label) {
          continue;
        }

        const metrics = computeArmCorrectionFeaturesFromFrame(frameData, handSide);

        if (!metrics) {
          continue;
        }

        rows.push({
          sequenceId: sequence.id,
          category: sequence.category,
          frameNumber,
          handSide,
          features: featureVectorFromMetrics(metrics),
          label,
        });
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    rows,
  };
}

async function main() {
  await ensureDirectory(outputDir);
  const dataset = await buildDataset();
  await writeJsonFile(outputPath, dataset);
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
