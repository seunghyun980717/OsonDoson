import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildSequenceFaceCalibrationFromFrames,
  computeHeadFaceStrategy,
} from './head-face-strategies.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_DATA_ROOT = process.env.THREE_D_VIEWER_DATA_ROOT
  ? resolve(process.env.THREE_D_VIEWER_DATA_ROOT)
  : resolve(__dirname, '../../../../..');
const WORD_DIC_DIR = process.env.THREE_D_WORDS_ROOT
  ? resolve(process.env.THREE_D_WORDS_ROOT)
  : resolve(VIEWER_DATA_ROOT, 'word_dic');

function loadWordFrame(word, frameIndex) {
  const clip = loadWordClip(word);

  assert.ok(clip.frames[frameIndex], `${word} frame ${frameIndex} should exist`);
  return clip.frames[frameIndex];
}

function loadWordClip(word) {
  const filePath = resolve(WORD_DIC_DIR, `${word}.json`);

  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function roundedMouthStrength(morphs) {
  return morphs.mouthPucker + morphs.mouthFunnel;
}

function openMouthStrength(morphs) {
  return morphs.mouthOpen + morphs.jawOpen;
}

function smileStrength(morphs) {
  return (morphs.mouthSmileLeft + morphs.mouthSmileRight) * 0.5;
}

function frownStrength(morphs) {
  return (morphs.mouthFrownLeft + morphs.mouthFrownRight) * 0.5;
}

test('rounded mouth keypoint frame prefers pucker and funnel over open mouth', {
  skip: !existsSync(resolve(WORD_DIC_DIR, '깜빡하다.json')),
}, () => {
  const frame = loadWordFrame('깜빡하다', 13);
  const result = computeHeadFaceStrategy(frame, {
    mode: 'natural',
    blinkSync: { mode: 'average', threshold: 0.12 },
  });

  assert.ok(
    roundedMouthStrength(result.morphs) > openMouthStrength(result.morphs),
    `expected rounded mouth to dominate open mouth, got rounded=${roundedMouthStrength(result.morphs)} open=${openMouthStrength(result.morphs)}`,
  );
});

test('open mouth keypoint frame keeps open mouth stronger than rounded mouth', {
  skip: !existsSync(resolve(WORD_DIC_DIR, '아하.json')),
}, () => {
  const frame = loadWordFrame('아하', 20);
  const result = computeHeadFaceStrategy(frame, {
    mode: 'natural',
    blinkSync: { mode: 'average', threshold: 0.12 },
  });

  assert.ok(
    openMouthStrength(result.morphs) > roundedMouthStrength(result.morphs) * 3,
    `expected open mouth to dominate rounded mouth, got open=${openMouthStrength(result.morphs)} rounded=${roundedMouthStrength(result.morphs)}`,
  );
});

test('downward mouth corners suppress false smile in geoseullida', {
  skip: !existsSync(resolve(WORD_DIC_DIR, '\uAC70\uC2AC\uB9AC\uB2E4.json')),
}, () => {
  const clip = loadWordClip('\uAC70\uC2AC\uB9AC\uB2E4');
  const faceCalibration = buildSequenceFaceCalibrationFromFrames(clip.frames.slice(0, 3));
  const result = computeHeadFaceStrategy(clip.frames[15], {
    mode: 'faithful',
    faceCalibration,
    blinkSync: { mode: 'average', threshold: 0.12 },
  });

  assert.ok(
    frownStrength(result.morphs) > smileStrength(result.morphs),
    `expected frown to dominate false smile, got frown=${frownStrength(result.morphs)} smile=${smileStrength(result.morphs)}`,
  );
  assert.ok(
    smileStrength(result.morphs) < 0.05,
    `expected smile to be suppressed, got smile=${smileStrength(result.morphs)}`,
  );
});

test('geoleumgeori neutral mouth does not become a one-sided smile', {
  skip: !existsSync(resolve(WORD_DIC_DIR, '\uAC78\uC74C\uAC78\uC774.json')),
}, () => {
  const clip = loadWordClip('\uAC78\uC74C\uAC78\uC774');
  const faceCalibration = buildSequenceFaceCalibrationFromFrames(clip.frames.slice(0, 3));
  const maxSmile = clip.frames.reduce((maxValue, frame) => {
    const result = computeHeadFaceStrategy(frame, {
      mode: 'faithful',
      faceCalibration,
      blinkSync: { mode: 'average', threshold: 0.12 },
    });

    return Math.max(maxValue, smileStrength(result.morphs));
  }, 0);

  assert.ok(
    maxSmile < 0.15,
    `expected neutral walking mouth smile to stay subtle, got smile=${maxSmile}`,
  );
});

test('gayeopda falling mouth corners do not become a one-sided smile', {
  skip: !existsSync(resolve(WORD_DIC_DIR, '\uAC00\uC5FE\uB2E4.json')),
}, () => {
  const clip = loadWordClip('\uAC00\uC5FE\uB2E4');
  const faceCalibration = buildSequenceFaceCalibrationFromFrames(clip.frames.slice(0, 3));
  const maxSmile = clip.frames.reduce((maxValue, frame) => {
    const result = computeHeadFaceStrategy(frame, {
      mode: 'faithful',
      faceCalibration,
      blinkSync: { mode: 'average', threshold: 0.12 },
    });

    return Math.max(maxValue, smileStrength(result.morphs));
  }, 0);

  assert.ok(
    maxSmile < 0.15,
    `expected falling mouth corners to stay out of smile morphs, got smile=${maxSmile}`,
  );
});
