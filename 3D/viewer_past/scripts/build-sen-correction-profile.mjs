import path from 'node:path';
import {
  CORRECTION_EPSILON,
  buildRuleProfile,
  buildLinearProfile,
  createSequenceSplit,
  evaluateBinaryMetrics,
  evaluateCorrectionProfile,
  evaluateRegressionMetrics,
  computeArmCorrectionFeaturesFromFrame,
} from '../src/lib/sen-correction.js';
import {
  readJsonFile,
  writeJsonFile,
} from './lib/fs-json.mjs';
import {
  generatedRoot,
  publicDataRoot,
} from './lib/paths.mjs';

const datasetPath = path.join(generatedRoot, 'sen-correction-dataset.json');
const benchmarkPath = path.join(generatedRoot, 'sen-correction-benchmark.json');
const profilePath = path.join(publicDataRoot, 'sen-correction-profile.json');

function evaluateRows(rows, profile, mode) {
  const predictions = rows.map((row) => {
    const result = evaluateCorrectionProfile(profile, {
      locals: {
        palm: {
          forward: row.features.palmForwardNorm,
          side: row.features.palmSideNorm,
          up: row.features.palmUpNorm,
        },
        wrist: {
          forward: row.features.wristForwardNorm,
          side: row.features.wristSideNorm,
          up: row.features.wristUpNorm,
        },
        elbow: {
          forward: row.features.elbowForwardNorm,
          side: row.features.elbowSideNorm,
          up: row.features.elbowUpNorm,
        },
      },
      directions: {
        upperArm: {
          forward: row.features.upperArmDirForward,
          side: row.features.upperArmDirSide,
          up: row.features.upperArmDirUp,
        },
        foreArm: {
          forward: row.features.foreArmDirForward,
          side: row.features.foreArmDirSide,
          up: row.features.foreArmDirUp,
        },
      },
      armExtensionRatio: row.features.armExtensionRatio,
      handSideSign: row.features.handSideSign,
      torsoRisk: row.features.torsoRisk,
    }, mode);

    return {
      wrist: result.wristForwardNorm,
      elbow: result.elbowForwardNorm,
    };
  });

  return {
    wristBinary: evaluateBinaryMetrics(rows, predictions.map((entry) => entry.wrist), 'wristForwardNorm'),
    elbowBinary: evaluateBinaryMetrics(rows, predictions.map((entry) => entry.elbow), 'elbowForwardNorm'),
    wristRegression: evaluateRegressionMetrics(rows, predictions.map((entry) => entry.wrist), 'wristForwardNorm'),
    elbowRegression: evaluateRegressionMetrics(rows, predictions.map((entry) => entry.elbow), 'elbowForwardNorm'),
  };
}

async function main() {
  const dataset = await readJsonFile(datasetPath);
  const sequenceIds = [...new Set(dataset.rows.map((row) => row.sequenceId))];
  const split = createSequenceSplit(sequenceIds);
  const trainRows = dataset.rows.filter((row) => split.train.includes(row.sequenceId));
  const validationRows = dataset.rows.filter((row) => split.validation.includes(row.sequenceId));
  const testRows = dataset.rows.filter((row) => split.test.includes(row.sequenceId));

  const ruleProfile = buildRuleProfile(trainRows);
  const linearProfile = buildLinearProfile(trainRows, validationRows);
  const runtimeProfile = {
    generatedAt: new Date().toISOString(),
    epsilon: CORRECTION_EPSILON,
    defaultMode: 'linear',
    availableModes: ['rule', 'linear'],
    rule: ruleProfile,
    linear: linearProfile,
  };
  const benchmark = {
    generatedAt: runtimeProfile.generatedAt,
    split,
    counts: {
      train: trainRows.length,
      validation: validationRows.length,
      test: testRows.length,
    },
    rule: {
      validation: evaluateRows(validationRows, runtimeProfile, 'rule'),
      test: evaluateRows(testRows, runtimeProfile, 'rule'),
    },
    linear: {
      validation: evaluateRows(validationRows, runtimeProfile, 'linear'),
      test: evaluateRows(testRows, runtimeProfile, 'linear'),
    },
  };

  await writeJsonFile(profilePath, runtimeProfile);
  await writeJsonFile(benchmarkPath, benchmark);
  console.log(`Wrote ${profilePath}`);
  console.log(`Wrote ${benchmarkPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
