import path from 'node:path';
import {
  clearDirectory,
  ensureDirectory,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from './lib/fs-json.mjs';
import { convertCocoWholeBodySequence } from '../src/converters/coco-wholebody-25d.js';
import {
  manifestPath as defaultManifestPath,
  publicDataRoot,
  publicFrameRoot as defaultFrameRoot,
  publicDataUrlForPath,
  resolveProjectPath,
} from './lib/paths.mjs';

function printUsage() {
  console.log(`Usage:
  node scripts/convert-coco-wholebody-sequence.mjs --input <source.json> --sequence-key <KEY> [options]

Options:
  --output-dir <dir>       Output frame directory. Defaults to public/data/sequences/<KEY>
  --manifest <path>        Manifest to update. Defaults to public/data/sequence-manifest.json
  --id <id>                Sequence id. Defaults to <KEY>
  --label <label>          Sequence label. Defaults to <KEY>
  --category <category>    Sequence category. Defaults to COCO25D
  --video <public-path>    Optional public video path for the manifest
  --fps <number>           Sequence fps. Defaults to 30
  --no-manifest            Write frames only
  --keep-output            Do not clear the output directory before writing
`);
}

function parseArgs(argv) {
  const options = {
    fps: 30,
    category: 'COCO25D',
    writeManifest: true,
    clearOutput: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--no-manifest') {
      options.writeManifest = false;
      continue;
    }

    if (arg === '--keep-output') {
      options.clearOutput = false;
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

  return options;
}

function normalizeOptions(rawOptions) {
  if (rawOptions.help) {
    return rawOptions;
  }

  const inputPath = rawOptions.input ? resolveProjectPath(rawOptions.input) : null;
  const sequenceKey = rawOptions['sequence-key'] ?? rawOptions.sequenceKey;

  if (!inputPath) {
    throw new Error('Missing required --input <source.json>.');
  }

  if (!sequenceKey) {
    throw new Error('Missing required --sequence-key <KEY>.');
  }

  return {
    ...rawOptions,
    inputPath,
    sequenceKey,
    outputDir: rawOptions['output-dir']
      ? resolveProjectPath(rawOptions['output-dir'])
      : path.join(defaultFrameRoot, sequenceKey),
    manifestPath: rawOptions.manifest
      ? resolveProjectPath(rawOptions.manifest)
      : defaultManifestPath,
    id: rawOptions.id ?? sequenceKey,
    label: rawOptions.label ?? sequenceKey,
    fps: Number(rawOptions.fps) || 30,
  };
}

function frameFileName(sequenceKey, frameIndex) {
  return `${sequenceKey}_${String(frameIndex).padStart(12, '0')}_keypoints.json`;
}

function publicFrameDirFromOutputDir(outputDir) {
  return publicDataUrlForPath(outputDir);
}

async function writeFrames(sequenceFrames, options) {
  if (options.clearOutput) {
    await clearDirectory(options.outputDir);
  } else {
    await ensureDirectory(options.outputDir);
  }

  const files = [];

  for (const frame of sequenceFrames) {
    const fileName = frameFileName(options.sequenceKey, frame.outputIndex);
    await writeJsonFile(path.join(options.outputDir, fileName), frame.frameData, {
      space: undefined,
    });
    files.push(fileName);
  }

  return files;
}

async function upsertManifestSequence(files, options) {
  const manifest = (await pathExists(options.manifestPath))
    ? await readJsonFile(options.manifestPath)
    : { sequences: [] };
  const sequences = Array.isArray(manifest.sequences) ? manifest.sequences : [];
  const frameDir = publicFrameDirFromOutputDir(options.outputDir);

  if (!frameDir) {
    throw new Error(`Manifest update requires --output-dir inside ${publicDataRoot}.`);
  }

  const nextSequence = {
    id: options.id,
    label: options.label,
    category: options.category,
    key: options.sequenceKey,
    frameDir,
    files,
    fps: options.fps,
  };

  if (options.video) {
    nextSequence.video = options.video;
  }

  const existingIndex = sequences.findIndex((sequence) => sequence.id === nextSequence.id);

  if (existingIndex >= 0) {
    sequences[existingIndex] = nextSequence;
  } else {
    sequences.push(nextSequence);
  }

  await ensureDirectory(path.dirname(options.manifestPath));
  await writeJsonFile(options.manifestPath, { ...manifest, sequences });
}

async function main() {
  const options = normalizeOptions(parseArgs(process.argv.slice(2)));

  if (options.help) {
    printUsage();
    return;
  }

  const input = await readJsonFile(options.inputPath);
  const sequenceFrames = convertCocoWholeBodySequence(input);

  if (!sequenceFrames.length) {
    throw new Error('No COCO-WholeBody frames with predictions[0].keypoints were found.');
  }

  const files = await writeFrames(sequenceFrames, options);

  if (options.writeManifest) {
    await upsertManifestSequence(files, options);
  }

  console.log(`Converted ${files.length} frames to ${options.outputDir}`);
  if (options.writeManifest) {
    console.log(`Updated ${options.manifestPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
