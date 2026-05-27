import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await loadEnvFiles([
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '.env'),
]);

const DEFAULT_DATA_ROOT = process.env.THREE_D_DATA_ROOT
  ? path.resolve(process.env.THREE_D_DATA_ROOT)
  : path.resolve(__dirname, '../data');
const DEFAULT_OUTPUT_DIR = process.env.THREE_D_WORDS_ROOT
  ? path.resolve(process.env.THREE_D_WORDS_ROOT)
  : path.join(DEFAULT_DATA_ROOT, 'words');
const SCHEMA_VERSION = 'sign-keypoint-clip/v1';
const DEFAULT_FPS = 30;
const IMAGE_WIDTH = 1920;
const IMAGE_HEIGHT = 1080;
const DEFAULT_CONCURRENCY = 32;

const COCO_BODY = Object.freeze({
  nose: 0,
  leftEye: 1,
  rightEye: 2,
  leftEar: 3,
  rightEar: 4,
  leftShoulder: 5,
  rightShoulder: 6,
  leftElbow: 7,
  rightElbow: 8,
  leftWrist: 9,
  rightWrist: 10,
  leftHip: 11,
  rightHip: 12,
  leftKnee: 13,
  rightKnee: 14,
  leftAnkle: 15,
  rightAnkle: 16,
  leftBigToe: 17,
  leftSmallToe: 18,
  leftHeel: 19,
  rightBigToe: 20,
  rightSmallToe: 21,
  rightHeel: 22,
});

const COCO_FACE_START = 23;
const COCO_FACE_COUNT = 68;
const COCO_LEFT_HAND_START = 91;
const COCO_RIGHT_HAND_START = 112;
const COCO_HAND_COUNT = 21;

const BODY_25_TO_COCO = Object.freeze([
  COCO_BODY.nose,
  null,
  COCO_BODY.rightShoulder,
  COCO_BODY.rightElbow,
  COCO_BODY.rightWrist,
  COCO_BODY.leftShoulder,
  COCO_BODY.leftElbow,
  COCO_BODY.leftWrist,
  null,
  COCO_BODY.rightHip,
  COCO_BODY.rightKnee,
  COCO_BODY.rightAnkle,
  COCO_BODY.leftHip,
  COCO_BODY.leftKnee,
  COCO_BODY.leftAnkle,
  COCO_BODY.rightEye,
  COCO_BODY.leftEye,
  COCO_BODY.rightEar,
  COCO_BODY.leftEar,
  COCO_BODY.leftBigToe,
  COCO_BODY.leftSmallToe,
  COCO_BODY.leftHeel,
  COCO_BODY.rightBigToe,
  COCO_BODY.rightSmallToe,
  COCO_BODY.rightHeel,
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    concurrency: DEFAULT_CONCURRENCY,
    output: DEFAULT_OUTPUT_DIR,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${arg}`);
    }

    options[key] = value;
    index += 1;
  }

  if (options.help) {
    return options;
  }

  if (!['aihub', 'corpus'].includes(options.type)) {
    throw new Error('Missing or invalid --type. Use "aihub" or "corpus".');
  }

  if (options.type === 'aihub' && (!options['keypoint-root'] || !options['morpheme-root'])) {
    throw new Error('AIHub conversion requires --keypoint-root and --morpheme-root.');
  }

  if (options.type === 'corpus' && !options['corpus-dir']) {
    throw new Error('Corpus conversion requires --corpus-dir.');
  }

  return {
    ...options,
    keypointRoot: options['keypoint-root'] ? resolvePath(options['keypoint-root']) : null,
    morphemeRoot: options['morpheme-root'] ? resolvePath(options['morpheme-root']) : null,
    corpusDir: options['corpus-dir'] ? resolvePath(options['corpus-dir']) : null,
    outputDir: resolvePath(options.output),
    concurrency: Math.max(1, Number(options.concurrency) || DEFAULT_CONCURRENCY),
  };
}

function printUsage() {
  console.log(`Usage:
  node build-word-json.mjs --type aihub --keypoint-root <dir> --morpheme-root <dir> [--output <dir>]
  node build-word-json.mjs --type corpus --corpus-dir <dir> [--output <dir>]

Options:
  --type <aihub|corpus>      Source dataset type.
  --keypoint-root <dir>      AIHub keypoint root. Only folders ending in _F are used.
  --morpheme-root <dir>      AIHub morpheme root.
  --corpus-dir <dir>         Directory containing corpus JSON files.
  --output <dir>             Output word JSON directory. Defaults to THREE_D_WORDS_ROOT or ../data/words.
  --concurrency <number>     Max concurrent file operations. Defaults to ${DEFAULT_CONCURRENCY}.
`);
}

function resolvePath(value) {
  return path.resolve(process.cwd(), value);
}

async function loadEnvFiles(filePaths) {
  for (const filePath of filePaths) {
    let content;

    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }

      throw error;
    }

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

async function readJson(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content.replace(/^\uFEFF/, ''));
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(rootDir) {
  const entries = (await fs.readdir(rootDir, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

async function listDirsRecursive(rootDir) {
  const entries = (await fs.readdir(rootDir, { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const dirs = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      dirs.push(fullPath);
      dirs.push(...await listDirsRecursive(fullPath));
    }
  }

  return dirs;
}

async function findAihubFrontSamples(keypointRoot, morphemeRoot) {
  const dirs = await listDirsRecursive(keypointRoot);
  const frontDirs = dirs
    .filter((dirPath) => path.basename(dirPath).endsWith('_F'))
    .sort((a, b) => a.localeCompare(b, 'ko'));

  return frontDirs.map((keypointDir) => {
    const sequenceId = path.basename(keypointDir);
    const groupName = path.basename(path.dirname(keypointDir));
    const morphemePath = path.join(morphemeRoot, groupName, `${sequenceId}_morpheme.json`);

    return { sequenceId, groupName, keypointDir, morphemePath };
  });
}

async function findCorpusFiles(corpusDir) {
  const files = await listFilesRecursive(corpusDir);
  return files
    .filter((filePath) => filePath.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

async function readAihubSample(sampleRef, report, concurrency, existingWordPriorities, runWordReservations) {
  if (!await pathExists(sampleRef.morphemePath)) {
    report.failures.push({
      type: 'aihub',
      id: sampleRef.sequenceId,
      reason: `Missing morpheme file: ${sampleRef.morphemePath}`,
    });
    return [];
  }

  const frameFiles = (await fs.readdir(sampleRef.keypointDir))
    .filter((name) => name.endsWith('_keypoints.json'))
    .sort();

  if (!frameFiles.length) {
    report.failures.push({
      type: 'aihub',
      id: sampleRef.sequenceId,
      reason: `No keypoint frames: ${sampleRef.keypointDir}`,
    });
    return [];
  }

  const morpheme = await readJson(sampleRef.morphemePath);
  const fps = estimateFps(morpheme?.metaData?.duration, frameFiles.length);
  const segments = Array.isArray(morpheme?.data) ? morpheme.data : [];
  const segmentEntries = segments.flatMap((segment, segmentIndex) =>
    extractMorphemeWords(segment).map((word, wordIndex) => {
      const range = frameRangeBySegment(segment, fps, frameFiles.length);
      return {
        segment,
        segmentIndex,
        word,
        wordIndex,
        range,
      };
    }),
  );
  report.candidate_segments += segmentEntries.length;

  const selectedEntries = [];
  const datasetPriority = sourcePriorityFromDataset('aihub_real_sen');

  for (const entry of segmentEntries) {
    if (hasAtLeastPriority(existingWordPriorities, entry.word, datasetPriority)) {
      report.skipped_existing += 1;
      continue;
    }

    if (hasAtLeastPriority(runWordReservations, entry.word, datasetPriority)) {
      report.skipped_duplicate += 1;
      continue;
    }

    runWordReservations.set(entry.word, datasetPriority);
    selectedEntries.push(entry);
  }

  if (!selectedEntries.length) {
    return [];
  }

  const requiredIndexes = collectRequiredFrameIndexes(selectedEntries);
  const framesByIndex = await readAihubFrames(sampleRef.keypointDir, frameFiles, requiredIndexes, concurrency);

  return selectedEntries.map((entry) => ({
      dataset: 'aihub_real_sen',
      sequenceId: sampleRef.sequenceId,
      videoRef: morpheme?.metaData?.name ?? `${sampleRef.sequenceId}.mp4`,
      sourcePath: sampleRef.keypointDir,
      segment: entry.segment,
      segmentIndex: entry.segmentIndex,
      word: entry.word,
      wordIndex: entry.wordIndex,
      fps,
      width: IMAGE_WIDTH,
      height: IMAGE_HEIGHT,
      frameCount: frameFiles.length,
      framesByIndex,
    }));
}

async function readCorpusSample(filePath, report) {
  const source = await readJson(filePath);
  const framesSource = Array.isArray(source?.landmarks) ? source.landmarks : [];

  if (!framesSource.length) {
    report.failures.push({
      type: 'corpus',
      id: path.basename(filePath),
      reason: 'No landmarks frames.',
    });
    return [];
  }

  const fps = Number(source?.potogrf?.fps) || DEFAULT_FPS;
  const width = Number(source?.potogrf?.width) || IMAGE_WIDTH;
  const height = Number(source?.potogrf?.height) || IMAGE_HEIGHT;
  const sequenceId = source?.id ?? source?.vido_file_nm ?? path.basename(filePath, '.json');
  const frames = framesSource
    .map((entry, index) => ({
      frameNumber: Number(entry?.frame ?? index + 1),
      sourceName: String(entry?.frame ?? index + 1),
      frameData: entry,
    }))
    .filter((entry) => Array.isArray(entry.frameData?.predictions?.[0]?.keypoints));

  return extractCorpusSegments(source).map((segment, segmentIndex) => ({
    dataset: 'corpus',
    sequenceId,
    videoRef: source?.vido_file_nm ?? null,
    sourcePath: filePath,
    segment,
    segmentIndex,
    word: cleanWord(segment.gloss_id),
    wordIndex: 0,
    fps,
    width,
    height,
    frames,
    frameCount: frames.length,
  }));
}

async function readAihubFrames(keypointDir, frameFiles, indexes, concurrency) {
  const frames = await mapLimit(indexes, concurrency, async (frameIndex) => {
    const fileName = frameFiles[frameIndex];
    return {
      frameNumber: frameIndex,
      sourceName: fileName,
      frameData: await readJson(path.join(keypointDir, fileName)),
    };
  });

  return new Map(frames.map((frame) => [frame.frameNumber, frame]));
}

function collectRequiredFrameIndexes(segmentEntries) {
  const indexes = new Set();

  for (const entry of segmentEntries) {
    for (let index = entry.range.sourceStartFrame; index < entry.range.sourceEndFrameExclusive; index += 1) {
      indexes.add(index);
    }
  }

  return [...indexes].sort((a, b) => a - b);
}

function extractMorphemeWords(segment) {
  return (Array.isArray(segment?.attributes) ? segment.attributes : [])
    .map((attribute) => cleanWord(attribute?.name))
    .filter(Boolean);
}

function extractCorpusSegments(source) {
  const strong = source?.sign_script?.sign_gestures_strong;
  const sourceSegments = Array.isArray(strong) ? strong : [];

  return sourceSegments
    .filter((segment) => cleanWord(segment?.gloss_id))
    .sort((a, b) => Number(a.start) - Number(b.start));
}

function estimateFps(duration, frameCount) {
  const durationNumber = Number(duration);

  if (Number.isFinite(durationNumber) && durationNumber > 0 && frameCount > 0) {
    return Math.round(frameCount / durationNumber) || DEFAULT_FPS;
  }

  return DEFAULT_FPS;
}

function cropFramesBySegment(frames, segment, fps) {
  const range = frameRangeBySegment(segment, fps, frames.length);

  return {
    frames: frames.slice(range.sourceStartFrame, range.sourceEndFrameExclusive),
    ...range,
  };
}

function cropFramesBySegmentFromMap(framesByIndex, segment, fps, frameCount) {
  const range = frameRangeBySegment(segment, fps, frameCount);
  const frames = [];

  for (let index = range.sourceStartFrame; index < range.sourceEndFrameExclusive; index += 1) {
    const frame = framesByIndex.get(index);

    if (frame) {
      frames.push(frame);
    }
  }

  return {
    frames,
    ...range,
  };
}

function frameRangeBySegment(segment, fps, frameCount) {
  const startSec = Number(segment?.start) || 0;
  const endSec = Number(segment?.end) || startSec;
  const sourceStartFrame = Math.max(0, Math.floor(startSec * fps));
  const sourceEndFrameExclusive = Math.min(
    frameCount,
    Math.max(sourceStartFrame + 1, Math.ceil(endSec * fps)),
  );

  return {
    sourceStartSec: startSec,
    sourceEndSec: endSec,
    sourceStartFrame,
    sourceEndFrameExclusive,
  };
}

function extractImage2D(frame, dataset) {
  if (dataset === 'aihub_real_sen') {
    const people = frame.frameData?.people ?? {};
    return {
      pose: flatToPoints(people.pose_keypoints_2d, 3),
      face: flatToPoints(people.face_keypoints_2d, 3),
      left_hand: flatToPoints(people.hand_left_keypoints_2d, 3),
      right_hand: flatToPoints(people.hand_right_keypoints_2d, 3),
    };
  }

  return convertCocoWholeBodyToParts(frame.frameData?.predictions?.[0]?.keypoints);
}

function extractCalibrated3D(frame, dataset) {
  if (dataset !== 'aihub_real_sen') {
    return null;
  }

  const people = frame.frameData?.people ?? {};
  const parts = {
    pose: flatToPoints(people.pose_keypoints_3d, 4),
    face: flatToPoints(people.face_keypoints_3d, 4),
    left_hand: flatToPoints(people.hand_left_keypoints_3d, 4),
    right_hand: flatToPoints(people.hand_right_keypoints_3d, 4),
  };

  return Object.values(parts).some((points) => points.length) ? parts : null;
}

function buildDepthHint(image2d) {
  return {
    pose: image2d.pose.map((point, index) => [poseDepth(index), point[2] ?? 0]),
    face: image2d.face.map((point) => [0.12, point[2] ?? 0]),
    left_hand: image2d.left_hand.map((point) => [0.35, point[2] ?? 0]),
    right_hand: image2d.right_hand.map((point) => [0.35, point[2] ?? 0]),
  };
}

function poseDepth(index) {
  if ([0, 15, 16, 17, 18].includes(index)) return 0.12;
  if ([3, 6].includes(index)) return 0.22;
  if ([4, 7].includes(index)) return 0.3;
  return 0;
}

function buildWordSample(candidate) {
  const cropped = candidate.framesByIndex
    ? cropFramesBySegmentFromMap(candidate.framesByIndex, candidate.segment, candidate.fps, candidate.frameCount)
    : cropFramesBySegment(candidate.frames, candidate.segment, candidate.fps);
  let hasCalibrated3D = false;
  const frames = cropped.frames.map((frame, frameIndex) => {
    const image2d = extractImage2D(frame, candidate.dataset);
    const calibrated3d = extractCalibrated3D(frame, candidate.dataset);
    const depthHint = calibrated3d ? null : buildDepthHint(image2d);
    hasCalibrated3D ||= calibrated3d !== null;

    return {
      frame_index: frameIndex,
      people: buildViewerPeople(image2d, calibrated3d ?? buildFallback3D(image2d, depthHint)),
    };
  });

  return {
    sample_id: buildSampleId(candidate),
    schema_version: SCHEMA_VERSION,
    gloss: candidate.word,
    fps: candidate.fps,
    source: {
      dataset: candidate.dataset,
      video_id: candidate.sequenceId,
      video_ref: candidate.videoRef,
      source_path: candidate.sourcePath,
    },
    segment: {
      source_start_sec: cropped.sourceStartSec,
      source_end_sec: cropped.sourceEndSec,
      source_start_frame: cropped.sourceStartFrame,
      source_end_frame_exclusive: cropped.sourceEndFrameExclusive,
    },
    processing: {
      cropped_to_segment: true,
      coordinate_normalization: 'none',
      depth_source: hasCalibrated3D ? 'calibrated_3d' : 'depth_hint',
      depth_hint_method: hasCalibrated3D ? null : 'front_view_occlusion_v1',
      estimated_3d_method: null,
    },
    frames,
  };
}

function mergeWordSample(wordFiles, word, sample) {
  if (!wordFiles.has(word)) {
    wordFiles.set(word, sample);
    return;
  }

  const wordJson = wordFiles.get(word);

  if (shouldReplaceRepresentative(wordJson, sample)) {
    wordFiles.set(word, sample);
  }
}

async function loadExistingWordPriorities(outputDir) {
  const priorities = new Map();

  if (!await pathExists(outputDir)) {
    return priorities;
  }

  const entries = await fs.readdir(outputDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
      continue;
    }

    const filePath = path.join(outputDir, entry.name);

    try {
      const wordJson = await readJson(filePath);
      const sample = getRepresentativeSample(wordJson);
      const word = cleanWord(wordJson?.gloss ?? wordJson?.word ?? path.basename(entry.name, '.json'));

      if (word && sample) {
        priorities.set(word, sourcePriority(sample));
      }
    } catch {
      // A bad existing output file should not block a new conversion run.
    }
  }

  return priorities;
}

async function writeWordFiles(wordFiles, outputDir) {
  await ensureDir(outputDir);
  const written = [];

  for (const [word, wordJson] of [...wordFiles.entries()].sort(([a], [b]) => a.localeCompare(b, 'ko'))) {
    const filePath = path.join(outputDir, `${sanitizeFileName(word)}.json`);
    const mergedWordJson = await mergeWithExistingWordFile(filePath, wordJson);
    await fs.writeFile(filePath, `${JSON.stringify(mergedWordJson, null, 2)}\n`, 'utf8');
    written.push(filePath);
  }

  return written;
}

async function mergeWithExistingWordFile(filePath, nextWordJson) {
  if (!await pathExists(filePath)) {
    return nextWordJson;
  }

  const existing = await readJson(filePath);
  const existingSample = getRepresentativeSample(existing);
  const nextSample = getRepresentativeSample(nextWordJson);

  if (!existingSample) {
    return nextWordJson;
  }

  if (!nextSample || !shouldReplaceRepresentative(existingSample, nextSample)) {
    return existingSample;
  }

  return nextSample;
}

function getRepresentativeSample(wordJson) {
  if (wordJson?.schema_version === SCHEMA_VERSION && Array.isArray(wordJson?.frames)) {
    return wordJson;
  }

  return null;
}

function shouldReplaceRepresentative(existingSample, nextSample) {
  if (!existingSample) {
    return true;
  }

  if (!nextSample) {
    return false;
  }

  return sourcePriority(nextSample) > sourcePriority(existingSample);
}

function sourcePriority(sample) {
  return sourcePriorityFromDataset(sample?.source?.dataset);
}

function sourcePriorityFromDataset(dataset) {
  if (dataset === 'aihub_real_sen') {
    return 2;
  }

  if (dataset === 'corpus') {
    return 1;
  }

  return 0;
}

function hasAtLeastPriority(priorities, word, priority) {
  return (priorities.get(word) ?? 0) >= priority;
}

function buildViewerPeople(image2d, parts3d) {
  return {
    pose_keypoints_2d: flattenPart(image2d.pose),
    pose_keypoints_3d: flattenPart(parts3d.pose),
    hand_left_keypoints_2d: flattenPart(image2d.left_hand),
    hand_left_keypoints_3d: flattenPart(parts3d.left_hand),
    hand_right_keypoints_2d: flattenPart(image2d.right_hand),
    hand_right_keypoints_3d: flattenPart(parts3d.right_hand),
    face_keypoints_2d: flattenPart(image2d.face),
    face_keypoints_3d: flattenPart(parts3d.face),
  };
}

function buildFallback3D(image2d, depthHint) {
  return {
    pose: mergeImage2DWithDepth(image2d.pose, depthHint.pose),
    face: mergeImage2DWithDepth(image2d.face, depthHint.face),
    left_hand: mergeImage2DWithDepth(image2d.left_hand, depthHint.left_hand),
    right_hand: mergeImage2DWithDepth(image2d.right_hand, depthHint.right_hand),
  };
}

function mergeImage2DWithDepth(points2d, depthPoints) {
  return points2d.map((point, index) => {
    const depth = depthPoints[index] ?? [0, point[2] ?? 0];
    return [point[0] ?? 0, point[1] ?? 0, depth[0] ?? 0, point[2] ?? depth[1] ?? 0];
  });
}

function flattenPart(points) {
  return points.flatMap((point) => point.map((value) => Number(value) || 0));
}

async function writeReport(report, outputDir) {
  const reportDir = path.join(path.dirname(outputDir), 'reports');
  await ensureDir(reportDir);
  const reportPath = path.join(reportDir, `word-json-report-${timestampForFile()}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

function flatToPoints(flatArray, stride) {
  if (!Array.isArray(flatArray)) return [];
  const points = [];

  for (let index = 0; index + stride - 1 < flatArray.length; index += stride) {
    points.push(Array.from({ length: stride }, (_, offset) => Number(flatArray[index + offset]) || 0));
  }

  return points;
}

function convertCocoWholeBodyToParts(flatKeypoints) {
  const coco = flatToCocoPoints(flatKeypoints);
  const pose = BODY_25_TO_COCO.map((cocoIndex) =>
    cocoIndex === null ? [0, 0, 0] : pointToArray(coco[cocoIndex]),
  );
  pose[1] = averagePointArrays([coco[COCO_BODY.leftShoulder], coco[COCO_BODY.rightShoulder]]);
  pose[8] = averagePointArrays([coco[COCO_BODY.leftHip], coco[COCO_BODY.rightHip]]);

  return {
    pose,
    face: coco.slice(COCO_FACE_START, COCO_FACE_START + COCO_FACE_COUNT).map(pointToArray),
    left_hand: coco.slice(COCO_LEFT_HAND_START, COCO_LEFT_HAND_START + COCO_HAND_COUNT).map(pointToArray),
    right_hand: coco.slice(COCO_RIGHT_HAND_START, COCO_RIGHT_HAND_START + COCO_HAND_COUNT).map(pointToArray),
  };
}

function flatToCocoPoints(flatKeypoints) {
  const points = flatToPoints(flatKeypoints, 3);

  if (points.length < COCO_RIGHT_HAND_START + COCO_HAND_COUNT) {
    throw new Error(`Expected COCO WholeBody keypoints, received ${points.length} points.`);
  }

  return points;
}

function pointToArray(point) {
  return point ? [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0] : [0, 0, 0];
}

function averagePointArrays(points) {
  const visible = points.filter((point) => point && (point[2] ?? 0) > 0);

  if (!visible.length) return [0, 0, 0];

  const sum = visible.reduce(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1], acc[2] + point[2]],
    [0, 0, 0],
  );

  return [sum[0] / visible.length, sum[1] / visible.length, sum[2] / visible.length];
}

function buildPartBlock(frames, stride) {
  return {
    pose: buildPart(frames, 'pose', stride),
    face: buildPart(frames, 'face', stride),
    left_hand: buildPart(frames, 'left_hand', stride),
    right_hand: buildPart(frames, 'right_hand', stride),
  };
}

function buildPart(frames, partName, stride) {
  const jointCount = frames[0]?.[partName]?.length ?? 0;

  return {
    shape: [frames.length, jointCount, stride],
    values: frames.map((frame) => frame[partName] ?? []),
  };
}

function buildSampleId(candidate) {
  const wordPart = sanitizeFileName(candidate.word);
  const indexPart = String(candidate.segmentIndex).padStart(3, '0');
  const attrPart = String(candidate.wordIndex).padStart(2, '0');
  return `${candidate.sequenceId}__${wordPart}__${indexPart}_${attrPart}`;
}

function cleanWord(value) {
  return String(value ?? '').trim();
}

function sanitizeFileName(value) {
  const sanitized = cleanWord(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  return sanitized || 'unknown';
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function formatDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(seconds).padStart(2, '0'),
  ].join(':') + `.${String(millis).padStart(3, '0')}`;
}

function collectCandidates(candidates, wordFiles, report, existingWordPriorities, countCandidates = true) {
  if (countCandidates) {
    report.candidate_segments += candidates.length;
  }

  for (const candidate of candidates) {
    try {
      const candidatePriority = sourcePriorityFromDataset(candidate.dataset);

      if (hasAtLeastPriority(existingWordPriorities, candidate.word, candidatePriority)) {
        report.skipped_existing += 1;
        continue;
      }

      const currentSample = wordFiles.get(candidate.word);

      if (currentSample && sourcePriority(currentSample) >= candidatePriority) {
        report.skipped_duplicate += 1;
        continue;
      }

      const sample = buildWordSample(candidate);

      if (!sample.frames.length) {
        throw new Error('Empty cropped segment.');
      }

      mergeWordSample(wordFiles, candidate.word, sample);
      existingWordPriorities.set(candidate.word, sourcePriority(sample));
      report.converted_samples += 1;
    } catch (error) {
      report.failures.push({
        type: candidate.dataset,
        id: candidate.sequenceId,
        word: candidate.word,
        reason: error.message,
      });
    }
  }
}

async function main() {
  const startedAtMs = Date.now();
  const options = parseArgs();

  if (options.help) {
    printUsage();
    return;
  }

  const report = {
    type: options.type,
    started_at: new Date().toISOString(),
    scanned: 0,
    candidate_segments: 0,
    converted_samples: 0,
    skipped_existing: 0,
    skipped_duplicate: 0,
    written_files: 0,
    failures: [],
  };
  const wordFiles = new Map();
  const existingWordPriorities = await loadExistingWordPriorities(options.outputDir);

  if (options.type === 'aihub') {
    const sampleRefs = await findAihubFrontSamples(options.keypointRoot, options.morphemeRoot);
    report.scanned = sampleRefs.length;
    const runWordReservations = new Map();
    const sampleConcurrency = Math.max(1, Math.min(4, Math.ceil(options.concurrency / 16)));

    const candidateGroups = await mapLimit(sampleRefs, sampleConcurrency, (sampleRef) =>
      readAihubSample(
        sampleRef,
        report,
        options.concurrency,
        existingWordPriorities,
        runWordReservations,
      ));

    for (const candidates of candidateGroups) {
      collectCandidates(candidates, wordFiles, report, new Map(), false);
    }
  } else {
    const files = await findCorpusFiles(options.corpusDir);
    report.scanned = files.length;

    const candidateGroups = await mapLimit(files, options.concurrency, (file) =>
      readCorpusSample(file, report));

    for (const candidates of candidateGroups) {
      collectCandidates(candidates, wordFiles, report, existingWordPriorities);
    }
  }

  const written = await writeWordFiles(wordFiles, options.outputDir);
  const reportPath = await writeReport({
    ...report,
    written_files: written.length,
    finished_at: new Date().toISOString(),
    elapsed_ms: Date.now() - startedAtMs,
  }, options.outputDir);
  const elapsedMs = Date.now() - startedAtMs;

  console.log(`Converted samples: ${report.converted_samples}`);
  console.log(`Candidate segments: ${report.candidate_segments}`);
  console.log(`Skipped existing: ${report.skipped_existing}`);
  console.log(`Skipped duplicates: ${report.skipped_duplicate}`);
  console.log(`Written word files: ${written.length}`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`Report: ${reportPath}`);
  console.log(`Elapsed: ${formatDuration(elapsedMs)} (${elapsedMs} ms)`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
