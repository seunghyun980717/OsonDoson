import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMA_VERSION = 'sign-keypoint-clip/v1';
const DEFAULT_FPS = 30;
const DEFAULT_CONCURRENCY = 32;
const FACE_POINT_COUNT = 68;
const COORDINATE_NORMALIZATION = 'shoulder-root-relative/v1';
const POSE_RIGHT_SHOULDER_INDEX = 2;
const POSE_LEFT_SHOULDER_INDEX = 5;
const SEN_WORD_Z_POLARITY = 1;
const DEFAULT_KEYPOINT_ROOT = 'D:/ssafy/3_자율/수어 영상/1.Training';
const DEFAULT_MORPHEME_ROOT = 'D:/ssafy/3_자율/수어 영상/1.Training/[라벨]01_real_sen_morpheme/morpheme';
const DEFAULT_OUTPUT_DIR = 'D:/ssafy/3_자율/sen_word_dic';
const DEFAULT_PRIMARY_WORD_DIR = 'D:/ssafy/3_자율/word_dic';
const REQUIRED_PARTS = Object.freeze([
  ['pose_keypoints_2d', 3],
  ['pose_keypoints_3d', 4],
  ['hand_left_keypoints_2d', 3],
  ['hand_left_keypoints_3d', 4],
  ['hand_right_keypoints_2d', 3],
  ['hand_right_keypoints_3d', 4],
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    keypointRoot: DEFAULT_KEYPOINT_ROOT,
    morphemeRoot: DEFAULT_MORPHEME_ROOT,
    outputDir: DEFAULT_OUTPUT_DIR,
    primaryWordDir: DEFAULT_PRIMARY_WORD_DIR,
    concurrency: DEFAULT_CONCURRENCY,
    limit: null,
    overwrite: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--overwrite') {
      options.overwrite = true;
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

    if (key === 'keypoint-root') options.keypointRoot = resolvePath(value);
    else if (key === 'morpheme-root') options.morphemeRoot = resolvePath(value);
    else if (key === 'output') options.outputDir = resolvePath(value);
    else if (key === 'primary-word-dir') options.primaryWordDir = resolvePath(value);
    else if (key === 'concurrency') options.concurrency = Math.max(1, Number(value) || DEFAULT_CONCURRENCY);
    else if (key === 'limit') options.limit = Math.max(1, Number(value) || 1);
    else throw new Error(`Unknown option: ${arg}`);

    index += 1;
  }

  options.keypointRoot = resolvePath(options.keypointRoot);
  options.morphemeRoot = resolvePath(options.morphemeRoot);
  options.outputDir = resolvePath(options.outputDir);
  options.primaryWordDir = resolvePath(options.primaryWordDir);
  return options;
}

function printUsage() {
  console.log(`Usage:
  node build-aihub-sen-word-dictionary.mjs [options]

Options:
  --keypoint-root <dir>   AIHub training root or a sentence keypoint root. Defaults to local 1.Training path.
  --morpheme-root <dir>   AIHub sentence morpheme root. Defaults to local sentence morpheme path.
  --output <dir>          Output dictionary directory. Defaults to D:/ssafy/3_자율/sen_word_dic.
  --primary-word-dir <dir> Existing word dictionary to prioritize. Defaults to D:/ssafy/3_자율/word_dic.
  --concurrency <number>  Max concurrent sequence conversions. Defaults to ${DEFAULT_CONCURRENCY}.
  --limit <number>        Convert only the first N sequences for smoke testing.
  --overwrite             Replace existing output files and duplicate glosses in the current run.
  --help                  Show this message.
`);
}

function resolvePath(value) {
  return path.resolve(process.cwd(), value);
}

async function readJson(filePath) {
  const bytes = await fs.readFile(filePath);
  const candidates = [];

  for (const encoding of ['utf-8', 'euc-kr']) {
    try {
      const text = new TextDecoder(encoding).decode(bytes).replace(/^\uFEFF/, '');
      candidates.push({ json: JSON.parse(text), score: hangulScore(text) });
    } catch {
      // Try the next encoding.
    }
  }

  if (!candidates.length) {
    throw new Error(`Failed to parse JSON: ${filePath}`);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].json;
}

function hangulScore(value) {
  return (String(value).match(/[가-힣]/g) ?? []).length;
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

async function loadExistingGlosses(wordDir) {
  const glosses = new Set();

  if (!wordDir || !await pathExists(wordDir)) {
    return glosses;
  }

  const entries = await fs.readdir(wordDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      glosses.add(path.basename(entry.name, '.json'));
    }
  }

  return glosses;
}

async function findSequenceRefs(keypointRoot, morphemeRoot) {
  const keypointRoots = await findSentenceKeypointRoots(keypointRoot);
  const refs = [];

  for (const root of keypointRoots) {
    const splitDirs = (await fs.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

    for (const splitDir of splitDirs) {
      const splitName = splitDir.name;
      const splitPath = path.join(root, splitName);
      const sequenceDirs = (await fs.readdir(splitPath, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('NIA_SL_SEN'))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

      for (const sequenceDir of sequenceDirs) {
        const sequenceId = sequenceDir.name;
        refs.push({
          sequenceId,
          groupName: splitName,
          keypointDir: path.join(splitPath, sequenceId),
          morphemePath: path.join(morphemeRoot, splitName, `${sequenceId}_morpheme.json`),
        });
      }
    }
  }

  return refs.sort((a, b) => a.sequenceId.localeCompare(b.sequenceId, 'ko'));
}

async function findSentenceKeypointRoots(keypointRoot) {
  const rootName = path.basename(keypointRoot);

  if (rootName.endsWith('_real_sen_keypoint')) {
    return [keypointRoot];
  }

  const entries = await fs.readdir(keypointRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('_real_sen_keypoint'))
    .map((entry) => path.join(keypointRoot, entry.name))
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

async function processSequence(ref) {
  const failures = [];

  try {
    if (!await pathExists(ref.morphemePath)) {
      failures.push(failure(ref, `Missing morpheme file: ${ref.morphemePath}`));
      return { samples: [], failures };
    }

    const frameFiles = (await fs.readdir(ref.keypointDir))
      .filter((name) => name.endsWith('_keypoints.json'))
      .sort();

    if (!frameFiles.length) {
      failures.push(failure(ref, `No keypoint frames: ${ref.keypointDir}`));
      return { samples: [], failures };
    }

    const morpheme = await readJson(ref.morphemePath);
    const fps = estimateFps(morpheme?.metaData?.duration, frameFiles.length);
    const segments = Array.isArray(morpheme?.data) ? morpheme.data : [];
    const samples = [];

    for (const [segmentIndex, segment] of segments.entries()) {
      const words = extractMorphemeWords(segment);

      if (!words.length) {
        failures.push(failure(ref, `No gloss attributes in segment ${segmentIndex}`));
        continue;
      }

      const range = frameRangeBySegment(segment, fps, frameFiles.length);
      const croppedFrameFiles = frameFiles.slice(range.sourceStartFrame, range.sourceEndFrameExclusive);

      if (!croppedFrameFiles.length) {
        failures.push(failure(ref, `Empty frame range in segment ${segmentIndex}`));
        continue;
      }

      const frames = await readCroppedFrames(ref.keypointDir, croppedFrameFiles);

      for (const [wordIndex, gloss] of words.entries()) {
        samples.push(buildClip({
          ref,
          morpheme,
          fps,
          segment,
          segmentIndex,
          wordIndex,
          gloss,
          range,
          frames,
        }));
      }
    }

    if (!samples.length && !failures.length) {
      failures.push(failure(ref, 'No usable morpheme segments.'));
    }

    return { samples, failures };
  } catch (error) {
    failures.push(failure(ref, error.message));
    return { samples: [], failures };
  }
}

function failure(ref, reason) {
  return {
    sequence_id: ref.sequenceId,
    keypoint_dir: ref.keypointDir,
    morpheme_path: ref.morphemePath,
    reason,
  };
}

async function readCroppedFrames(keypointDir, frameFiles) {
  return Promise.all(frameFiles.map(async (fileName, frameIndex) => ({
    source_file: fileName,
    source_frame_offset: frameIndex,
    frameData: await readJson(path.join(keypointDir, fileName)),
  })));
}

function buildClip({ ref, morpheme, fps, segment, segmentIndex, wordIndex, gloss, range, frames }) {
  return {
    sample_id: buildSampleId(ref.sequenceId, gloss, segmentIndex, wordIndex),
    schema_version: SCHEMA_VERSION,
    gloss,
    fps,
    source: {
      dataset: 'aihub_real_sen',
      video_id: ref.sequenceId,
      video_ref: morpheme?.metaData?.name ?? `${ref.sequenceId}.mp4`,
      source_path: ref.keypointDir,
      morpheme_path: ref.morphemePath,
    },
    segment: {
      source_start_sec: Number(segment?.start) || 0,
      source_end_sec: Number(segment?.end) || Number(segment?.start) || 0,
      source_start_frame: range.sourceStartFrame,
      source_end_frame_exclusive: range.sourceEndFrameExclusive,
      frame_count: frames.length,
      segment_index: segmentIndex,
      word_index: wordIndex,
    },
    processing: {
      trim_policy: 'morpheme',
      cropped_to_segment: true,
      coordinate_normalization: COORDINATE_NORMALIZATION,
      coordinate_root: 'shoulder_center_3d',
      coordinate_scale: 'shoulder_width_3d',
      z_polarity: SEN_WORD_Z_POLARITY,
      depth_source: 'calibrated_3d',
    },
    frames: frames.map((frame, frameIndex) => ({
      frame_index: frameIndex,
      people: buildViewerPeople(frame.frameData?.people ?? {}),
    })),
  };
}

function buildViewerPeople(people) {
  validateRequiredParts(people);
  const parts3d = normalizeViewerPeople3D(people, SEN_WORD_Z_POLARITY);

  return {
    pose_keypoints_2d: flattenPart(flatToPoints(people.pose_keypoints_2d, 3)),
    pose_keypoints_3d: flattenPart(parts3d.pose),
    hand_left_keypoints_2d: flattenPart(flatToPoints(people.hand_left_keypoints_2d, 3)),
    hand_left_keypoints_3d: flattenPart(parts3d.leftHand),
    hand_right_keypoints_2d: flattenPart(flatToPoints(people.hand_right_keypoints_2d, 3)),
    hand_right_keypoints_3d: flattenPart(parts3d.rightHand),
    face_keypoints_2d: flattenPart(flatToPoints(people.face_keypoints_2d, 3).slice(0, FACE_POINT_COUNT)),
    face_keypoints_3d: flattenPart(parts3d.face.slice(0, FACE_POINT_COUNT)),
  };
}

function normalizeViewerPeople3D(people, zPolarity) {
  const pose = flatToPoints(people.pose_keypoints_3d, 4);
  const normalization = shoulderNormalizationFromPose(pose);

  return {
    pose: normalize3DPoints(pose, normalization, zPolarity),
    leftHand: normalize3DPoints(flatToPoints(people.hand_left_keypoints_3d, 4), normalization, zPolarity),
    rightHand: normalize3DPoints(flatToPoints(people.hand_right_keypoints_3d, 4), normalization, zPolarity),
    face: normalize3DPoints(flatToPoints(people.face_keypoints_3d, 4), normalization, zPolarity),
  };
}

function shoulderNormalizationFromPose(posePoints) {
  const rightShoulder = posePoints[POSE_RIGHT_SHOULDER_INDEX] ?? [0, 0, 0, 0];
  const leftShoulder = posePoints[POSE_LEFT_SHOULDER_INDEX] ?? [0, 0, 0, 0];
  const center = [
    (rightShoulder[0] + leftShoulder[0]) * 0.5,
    (rightShoulder[1] + leftShoulder[1]) * 0.5,
    (rightShoulder[2] + leftShoulder[2]) * 0.5,
  ];
  const width = Math.hypot(
    leftShoulder[0] - rightShoulder[0],
    leftShoulder[1] - rightShoulder[1],
    leftShoulder[2] - rightShoulder[2],
  );

  return {
    center,
    width: Math.max(width, 1e-6),
  };
}

function normalize3DPoints(points, normalization, zPolarity) {
  return points.map((point) => [
    ((point[0] ?? 0) - normalization.center[0]) / normalization.width,
    ((point[1] ?? 0) - normalization.center[1]) / normalization.width,
    (((point[2] ?? 0) - normalization.center[2]) / normalization.width) * zPolarity,
    point[3] ?? 0,
  ]);
}

function validateRequiredParts(people) {
  for (const [partName, stride] of REQUIRED_PARTS) {
    if (!Array.isArray(people?.[partName]) || people[partName].length < stride) {
      throw new Error(`Missing required keypoint part: ${partName}`);
    }
  }
}

function flatToPoints(flatArray, stride) {
  if (!Array.isArray(flatArray)) return [];
  const points = [];

  for (let index = 0; index + stride - 1 < flatArray.length; index += stride) {
    points.push(Array.from({ length: stride }, (_, offset) => Number(flatArray[index + offset]) || 0));
  }

  return points;
}

function flattenPart(points) {
  return points.flatMap((point) => point.map((value) => Number(value) || 0));
}

function extractMorphemeWords(segment) {
  return (Array.isArray(segment?.attributes) ? segment.attributes : [])
    .map((attribute) => cleanWord(attribute?.name))
    .filter(Boolean);
}

function estimateFps(duration, frameCount) {
  const durationNumber = Number(duration);

  if (Number.isFinite(durationNumber) && durationNumber > 0 && frameCount > 0) {
    return Math.round(frameCount / durationNumber) || DEFAULT_FPS;
  }

  return DEFAULT_FPS;
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
    sourceStartFrame,
    sourceEndFrameExclusive,
  };
}

function buildSampleId(sequenceId, gloss, segmentIndex, wordIndex) {
  const wordPart = sanitizeFileName(gloss);
  const segmentPart = String(segmentIndex).padStart(3, '0');
  const wordIndexPart = String(wordIndex).padStart(2, '0');
  return `${sequenceId}__${wordPart}__${segmentPart}_${wordIndexPart}`;
}

async function processAndWriteSamples(sequenceRefs, options, report) {
  await ensureDir(options.outputDir);
  const primaryGlosses = await loadExistingGlosses(options.primaryWordDir);
  report.primary_word_glosses = primaryGlosses.size;
  const samplesByGloss = new Map();
  let writeOperations = 0;

  for (let start = 0; start < sequenceRefs.length; start += options.concurrency) {
    const batch = sequenceRefs.slice(start, start + options.concurrency);
    const results = await Promise.all(batch.map((ref) => processSequence(ref)));

    for (const result of results) {
      report.failures.push(...result.failures);

      for (const sample of result.samples) {
        report.candidate_glosses += 1;

        if (primaryGlosses.has(sanitizeFileName(sample.gloss))) {
          report.skipped_primary_word += 1;
          continue;
        }

        if (samplesByGloss.has(sample.gloss)) {
          report.duplicate_glosses += 1;
          report.duplicates.push({
            gloss: sample.gloss,
            kept_sample_id: options.overwrite ? sample.sample_id : samplesByGloss.get(sample.gloss).sample_id,
            duplicate_sample_id: options.overwrite ? samplesByGloss.get(sample.gloss).sample_id : sample.sample_id,
          });

          if (!options.overwrite) {
            continue;
          }
        }

        const filePath = path.join(options.outputDir, `${sanitizeFileName(sample.gloss)}.json`);

        if (!options.overwrite && await pathExists(filePath)) {
          report.skipped_existing_output += 1;
          continue;
        }

        await fs.writeFile(filePath, `${JSON.stringify(sample, null, 2)}\n`, 'utf8');
        samplesByGloss.set(sample.gloss, { sample_id: sample.sample_id });
        writeOperations += 1;
      }
    }
  }

  report.unique_glosses = samplesByGloss.size;
  report.written_glosses = samplesByGloss.size;
  report.write_operations = writeOperations;
  return samplesByGloss.size;
}

async function writeReport(report, outputDir) {
  const reportDir = path.join(path.dirname(outputDir), 'reports');
  await ensureDir(reportDir);
  const reportPath = path.join(reportDir, `aihub-sen-word-dictionary-report-${timestampForFile()}.json`);
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return reportPath;
}

function cleanWord(value) {
  return String(value ?? '').trim();
}

function sanitizeFileName(value) {
  return cleanWord(value).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_') || 'unknown';
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function createReport(options) {
  return {
    schema_version: SCHEMA_VERSION,
    input: {
      keypoint_root: options.keypointRoot,
      morpheme_root: options.morphemeRoot,
      output_dir: options.outputDir,
      primary_word_dir: options.primaryWordDir,
      concurrency: options.concurrency,
      limit: options.limit,
      overwrite: options.overwrite,
    },
    sequences_found: 0,
    sequences_processed: 0,
    candidate_glosses: 0,
    unique_glosses: 0,
    written_glosses: 0,
    primary_word_glosses: 0,
    skipped_primary_word: 0,
    duplicate_glosses: 0,
    skipped_existing_output: 0,
    write_operations: 0,
    failures: [],
    duplicates: [],
    elapsed_ms: 0,
  };
}

async function main() {
  const startedAt = Date.now();
  const options = parseArgs();

  if (options.help) {
    printUsage();
    return;
  }

  if (!await pathExists(options.keypointRoot)) {
    throw new Error(`Keypoint root does not exist: ${options.keypointRoot}`);
  }

  if (!await pathExists(options.morphemeRoot)) {
    throw new Error(`Morpheme root does not exist: ${options.morphemeRoot}`);
  }

  if (options.primaryWordDir && !await pathExists(options.primaryWordDir)) {
    console.warn(`Primary word dictionary does not exist, skip priority filtering: ${options.primaryWordDir}`);
  }

  const report = createReport(options);
  let sequenceRefs = await findSequenceRefs(options.keypointRoot, options.morphemeRoot);
  report.sequences_found = sequenceRefs.length;

  if (options.limit) {
    sequenceRefs = sequenceRefs.slice(0, options.limit);
  }

  report.sequences_processed = sequenceRefs.length;
  const written = await processAndWriteSamples(sequenceRefs, options, report);
  report.elapsed_ms = Date.now() - startedAt;
  const reportPath = await writeReport(report, options.outputDir);

  console.log(`Sequences found: ${report.sequences_found}`);
  console.log(`Sequences processed: ${report.sequences_processed}`);
  console.log(`Candidate glosses: ${report.candidate_glosses}`);
  console.log(`Unique glosses: ${report.unique_glosses}`);
  console.log(`Written glosses: ${written}`);
  console.log(`Skipped primary word glosses: ${report.skipped_primary_word}`);
  console.log(`Failures: ${report.failures.length}`);
  console.log(`Duplicates: ${report.duplicate_glosses}`);
  console.log(`Output: ${options.outputDir}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
