import fs from 'node:fs/promises';
import path from 'node:path';
import {
  pathExists,
  readJsonFile,
  writeJsonFile,
} from './lib/fs-json.mjs';
import { frameNumberFromName } from './lib/frame-names.mjs';
import { publicSequenceFramePath } from './lib/sequence-paths.mjs';
import {
  manifestPath,
  multiviewLabelRoot,
  publicDataRoot,
} from './lib/paths.mjs';

const outputPath = path.join(publicDataRoot, 'multiview-analysis.json');
const labelRoot = multiviewLabelRoot;
const views = ['F', 'L', 'R', 'U', 'D'];

function getPoint3D(flatArray, index) {
  const base = index * 4;
  return {
    x: flatArray[base],
    y: flatArray[base + 1],
    z: flatArray[base + 2],
  };
}

function getPoint2D(flatArray, index) {
  const base = index * 3;
  return {
    x: flatArray[base],
    y: flatArray[base + 1],
    confidence: flatArray[base + 2],
  };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v, scalar) {
  return { x: v.x * scalar, y: v.y * scalar, z: v.z * scalar };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function length(v) {
  return Math.hypot(v.x, v.y, v.z);
}

function normalize(v, fallback = { x: 0, y: 1, z: 0 }) {
  const len = length(v);
  return len > 1e-8 ? scale(v, 1 / len) : { ...fallback };
}

function midpoint(a, b) {
  return scale(add(a, b), 0.5);
}

function closestPointOnSegment(point, start, end) {
  const segment = sub(end, start);
  const lengthSq = dot(segment, segment);

  if (lengthSq < 1e-8) {
    return { ...start };
  }

  const t = Math.max(0, Math.min(1, dot(sub(point, start), segment) / lengthSq));
  return add(start, scale(segment, t));
}

function quantile(values, q) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

function arrayMaxAbsDiff(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return Number.POSITIVE_INFINITY;
  }

  let maxDiff = 0;

  for (let i = 0; i < a.length; i += 1) {
    maxDiff = Math.max(maxDiff, Math.abs(a[i] - b[i]));
  }

  return maxDiff;
}

function computeTorsoFrame(frameData) {
  const pose = frameData.people.pose_keypoints_3d;
  const rightShoulder = getPoint3D(pose, 2);
  const leftShoulder = getPoint3D(pose, 5);
  const midHip = getPoint3D(pose, 8);
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const side = normalize(sub(rightShoulder, leftShoulder), { x: 1, y: 0, z: 0 });
  // Dataset Y is downward; world-up = (0,-1,0) in dataset.
  // cross(up, side) gives toward-camera direction (dataset -Z).
  const up = { x: 0, y: -1, z: 0 };
  const forward = normalize(cross(up, side), { x: 0, y: 0, z: -1 });

  return {
    shoulderCenter,
    midHip,
    side,
    up,
    forward,
    shoulderWidth: Math.max(length(sub(rightShoulder, leftShoulder)), 1e-6),
  };
}

function computePalmCenter(handFlatArray) {
  const indices = [0, 5, 9, 13, 17];
  let sum = { x: 0, y: 0, z: 0 };

  indices.forEach((index) => {
    sum = add(sum, getPoint3D(handFlatArray, index));
  });

  return scale(sum, 1 / indices.length);
}

function computeHandTorsoMetrics(frameData, handKey) {
  const handFlatArray = frameData.people[handKey];

  if (!Array.isArray(handFlatArray) || handFlatArray.length < 21 * 4) {
    return null;
  }

  const torso = computeTorsoFrame(frameData);
  const palmCenter = computePalmCenter(handFlatArray);
  const torsoStart = torso.shoulderCenter;
  const torsoEnd = torso.midHip;
  const closest = closestPointOnSegment(palmCenter, torsoStart, torsoEnd);
  const relative = sub(palmCenter, closest);

  return {
    side: dot(relative, torso.side),
    up: dot(relative, torso.up),
    forward: dot(relative, torso.forward),
    radial: length(relative),
    torsoRadius: torso.shoulderWidth * 0.33,
    shoulderWidth: torso.shoulderWidth,
  };
}

function isTorsoRisk(metrics) {
  if (!metrics) {
    return false;
  }

  return (
    Math.abs(metrics.side) < metrics.shoulderWidth * 0.6 &&
    metrics.up < metrics.shoulderWidth * 0.35 &&
    metrics.up > -metrics.shoulderWidth * 1.1 &&
    metrics.forward < metrics.shoulderWidth * 0.18 &&
    metrics.radial < metrics.torsoRadius * 1.35
  );
}

function computePalm2DCentroid(frameData, handKey) {
  const handFlatArray = frameData.people[handKey];

  if (!Array.isArray(handFlatArray) || handFlatArray.length < 21 * 3) {
    return null;
  }

  const indices = [0, 5, 9, 13, 17];
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  indices.forEach((index) => {
    const point = getPoint2D(handFlatArray, index);

    if (point.confidence > 0) {
      sumX += point.x;
      sumY += point.y;
      count += 1;
    }
  });

  if (!count) {
    return null;
  }

  return {
    x: sumX / count,
    y: sumY / count,
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function computeTorsoBounds2D(frameData) {
  const pose2d = frameData.people.pose_keypoints_2d;
  const indices = [1, 2, 5, 8, 9, 12];
  const points = indices
    .map((index) => getPoint2D(pose2d, index))
    .filter((point) => point.confidence > 0);

  if (!points.length) {
    return null;
  }

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, 1e-6);
  const height = Math.max(maxY - minY, 1e-6);

  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}

function computeTorsoOverlapSeverity2D(frameData, handKey) {
  const torsoBounds = computeTorsoBounds2D(frameData);
  const palmCenter = computePalm2DCentroid(frameData, handKey);

  if (!torsoBounds || !palmCenter) {
    return 0;
  }

  if (
    palmCenter.x < torsoBounds.minX ||
    palmCenter.x > torsoBounds.maxX ||
    palmCenter.y < torsoBounds.minY ||
    palmCenter.y > torsoBounds.maxY
  ) {
    return 0;
  }

  const dx = Math.abs(palmCenter.x - torsoBounds.centerX) / (torsoBounds.width * 0.5);
  const dy = Math.abs(palmCenter.y - torsoBounds.centerY) / (torsoBounds.height * 0.5);
  return clamp01(1 - Math.max(dx, dy));
}

function computeFrameCorrection(metrics, overlapByView) {
  if (!metrics) {
    return null;
  }

  const sideScore = Math.max(overlapByView.L ?? 0, overlapByView.R ?? 0);
  const verticalScore = Math.max(overlapByView.U ?? 0, overlapByView.D ?? 0);
  const overlapWeight = clamp01(sideScore + verticalScore * 0.35);

  if (overlapWeight < 0.12) {
    return null;
  }

  // Single-camera 3D depth is unreliable, so drive correction purely from
  // multi-view 2D overlap weight rather than subtracting metrics.forward.
  const wristForward = metrics.shoulderWidth * 0.40 * overlapWeight;

  if (wristForward < metrics.shoulderWidth * 0.03) {
    return null;
  }

  return {
    overlapWeight,
    wristForward,
    elbowForward: wristForward * 0.50,
    sideScore,
    verticalScore,
  };
}

function range(values) {
  if (!values.length) {
    return 0;
  }

  return Math.max(...values) - Math.min(...values);
}

async function getViewFiles(sequence, viewKey) {
  if (viewKey === 'F') {
    return sequence.files;
  }

  const baseKey = sequence.key.replace(/_F$/, '');
  const dirPath = path.join(labelRoot, `${baseKey}_${viewKey}`);

  if (!(await pathExists(dirPath))) {
    return [];
  }

  const entries = await fs.readdir(dirPath);
  return entries
    .filter((name) => name.endsWith('_keypoints.json'))
    .sort();
}

async function readFrame(sequence, viewKey, fileName) {
  let filePath;

  if (viewKey === 'F') {
    filePath = publicSequenceFramePath({ publicDataRoot }, sequence, fileName);
  } else {
    const baseKey = sequence.key.replace(/_F$/, '');
    filePath = path.join(labelRoot, `${baseKey}_${viewKey}`, fileName);
  }

  return readJsonFile(filePath);
}

async function analyzeSequence(sequence) {
  const filesByView = {};

  for (const view of views) {
    filesByView[view] = await getViewFiles(sequence, view);
  }

  const availableViews = views.filter((view) => filesByView[view].length > 0);
  const commonFrameCount = Math.min(...availableViews.map((view) => filesByView[view].length));
  let pose3dMaxAbsDiff = 0;
  let leftHand3dMaxAbsDiff = 0;
  let rightHand3dMaxAbsDiff = 0;
  const leftForwardDepths = [];
  const rightForwardDepths = [];
  const leftRiskFrames = [];
  const rightRiskFrames = [];
  const shoulderCenterXSpans = [];
  const leftPalmXSpans = [];
  const rightPalmXSpans = [];
  const frameCorrections = {};

  for (let frameIndex = 0; frameIndex < commonFrameCount; frameIndex += 1) {
    const viewFrames = {};

    for (const view of availableViews) {
      const fileName = filesByView[view][frameIndex];
      viewFrames[view] = await readFrame(sequence, view, fileName);
    }

    const referenceFrame = viewFrames.F ?? viewFrames[availableViews[0]];

    for (const view of availableViews) {
      if (view === (viewFrames.F ? 'F' : availableViews[0])) {
        continue;
      }

      pose3dMaxAbsDiff = Math.max(
        pose3dMaxAbsDiff,
        arrayMaxAbsDiff(referenceFrame.people.pose_keypoints_3d, viewFrames[view].people.pose_keypoints_3d),
      );
      leftHand3dMaxAbsDiff = Math.max(
        leftHand3dMaxAbsDiff,
        arrayMaxAbsDiff(referenceFrame.people.hand_left_keypoints_3d, viewFrames[view].people.hand_left_keypoints_3d),
      );
      rightHand3dMaxAbsDiff = Math.max(
        rightHand3dMaxAbsDiff,
        arrayMaxAbsDiff(referenceFrame.people.hand_right_keypoints_3d, viewFrames[view].people.hand_right_keypoints_3d),
      );
    }

    const leftMetrics = computeHandTorsoMetrics(referenceFrame, 'hand_left_keypoints_3d');
    const rightMetrics = computeHandTorsoMetrics(referenceFrame, 'hand_right_keypoints_3d');
    const frameNumber = frameNumberFromName(filesByView.F[frameIndex], frameIndex);
    const leftOverlapByView = {};
    const rightOverlapByView = {};

    if (leftMetrics) {
      leftForwardDepths.push(leftMetrics.forward);

      if (isTorsoRisk(leftMetrics)) {
        leftRiskFrames.push(frameNumber);
      }
    }

    if (rightMetrics) {
      rightForwardDepths.push(rightMetrics.forward);

      if (isTorsoRisk(rightMetrics)) {
        rightRiskFrames.push(frameNumber);
      }
    }

    const shoulderCentersX = [];
    const leftPalmsX = [];
    const rightPalmsX = [];

    availableViews.forEach((view) => {
      const pose2d = viewFrames[view].people.pose_keypoints_2d;
      const leftShoulder = getPoint2D(pose2d, 5);
      const rightShoulder = getPoint2D(pose2d, 2);
      shoulderCentersX.push((leftShoulder.x + rightShoulder.x) * 0.5);
      leftOverlapByView[view] = computeTorsoOverlapSeverity2D(viewFrames[view], 'hand_left_keypoints_2d');
      rightOverlapByView[view] = computeTorsoOverlapSeverity2D(viewFrames[view], 'hand_right_keypoints_2d');

      const leftPalm = computePalm2DCentroid(viewFrames[view], 'hand_left_keypoints_2d');
      const rightPalm = computePalm2DCentroid(viewFrames[view], 'hand_right_keypoints_2d');

      if (leftPalm) {
        leftPalmsX.push(leftPalm.x);
      }

      if (rightPalm) {
        rightPalmsX.push(rightPalm.x);
      }
    });

    shoulderCenterXSpans.push(range(shoulderCentersX));
    leftPalmXSpans.push(range(leftPalmsX));
    rightPalmXSpans.push(range(rightPalmsX));

    const leftCorrection = computeFrameCorrection(leftMetrics, leftOverlapByView);
    const rightCorrection = computeFrameCorrection(rightMetrics, rightOverlapByView);

    if (leftCorrection || rightCorrection) {
      frameCorrections[String(frameNumber)] = {
        left: leftCorrection,
        right: rightCorrection,
      };
    }
  }

  return {
    key: sequence.key,
    availableViews,
    frameCounts: Object.fromEntries(views.map((view) => [view, filesByView[view].length])),
    commonFrameCount,
    pose3dSharedAcrossViews: pose3dMaxAbsDiff < 1e-6,
    hand3dSharedAcrossViews: Math.max(leftHand3dMaxAbsDiff, rightHand3dMaxAbsDiff) < 1e-6,
    pose3dMaxAbsDiff,
    leftHand3dMaxAbsDiff,
    rightHand3dMaxAbsDiff,
    view2dSpread: {
      shoulderCenterXMeanSpan: quantile(shoulderCenterXSpans, 0.5),
      leftPalmXMeanSpan: quantile(leftPalmXSpans, 0.5),
      rightPalmXMeanSpan: quantile(rightPalmXSpans, 0.5),
    },
    leftHandForwardDepth: {
      p10: quantile(leftForwardDepths, 0.1),
      p50: quantile(leftForwardDepths, 0.5),
      p90: quantile(leftForwardDepths, 0.9),
    },
    rightHandForwardDepth: {
      p10: quantile(rightForwardDepths, 0.1),
      p50: quantile(rightForwardDepths, 0.5),
      p90: quantile(rightForwardDepths, 0.9),
    },
    torsoRiskFrames: {
      left: leftRiskFrames,
      right: rightRiskFrames,
    },
    frameCorrections,
  };
}

async function main() {
  const manifest = await readJsonFile(manifestPath);
  const sequences = manifest.sequences ?? [];
  const analysis = {
    generatedAt: new Date().toISOString(),
    sequences: {},
  };

  for (const sequence of sequences) {
    analysis.sequences[sequence.id] = await analyzeSequence(sequence);
  }

  await writeJsonFile(outputPath, analysis, { trailingNewline: false });
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
