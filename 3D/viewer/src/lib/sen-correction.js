export const HAND_SIDES = ['left', 'right'];
export const CORRECTION_EPSILON = 0.015;
export const FEATURE_NAMES = [
  'palmForwardNorm',
  'palmSideNorm',
  'palmUpNorm',
  'wristForwardNorm',
  'wristSideNorm',
  'wristUpNorm',
  'elbowForwardNorm',
  'elbowSideNorm',
  'elbowUpNorm',
  'upperArmDirForward',
  'upperArmDirSide',
  'upperArmDirUp',
  'foreArmDirForward',
  'foreArmDirSide',
  'foreArmDirUp',
  'armExtensionRatio',
  'handSideSign',
  'torsoRisk',
];

const HAND_CONFIG = {
  left: {
    pose: { shoulder: 5, elbow: 6, wrist: 7 },
    hand3d: 'hand_left_keypoints_3d',
    hand2d: 'hand_left_keypoints_2d',
    sideSign: -1,
  },
  right: {
    pose: { shoulder: 2, elbow: 3, wrist: 4 },
    hand3d: 'hand_right_keypoints_3d',
    hand2d: 'hand_right_keypoints_2d',
    sideSign: 1,
  },
};

const WORLD_UP = { x: 0, y: 1, z: 0 };

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value) {
  return clamp(value, 0, 1);
}

export function remapClamped(value, min, max) {
  if (max <= min) {
    return 0;
  }

  return clamp01((value - min) / (max - min));
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

function normalize(v, fallback = { x: 0, y: 0, z: 1 }) {
  const len = length(v);

  if (len <= 1e-8) {
    return { ...fallback };
  }

  return scale(v, 1 / len);
}

function midpoint(a, b) {
  return scale(add(a, b), 0.5);
}

function distance(a, b) {
  return length(sub(a, b));
}

function datasetPointToWorld(point) {
  return {
    x: point.x,
    y: -point.y,
    z: -point.z,
  };
}

function worldVectorToDataset(vector) {
  return {
    x: vector.x,
    y: -vector.y,
    z: -vector.z,
  };
}

function projectOntoPlane(vector, normal) {
  return sub(vector, scale(normal, dot(vector, normal)));
}

function quantile(values, q) {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.floor((sorted.length - 1) * q), 0, sorted.length - 1);
  return sorted[index];
}

export function getPoint3D(flatArray, index) {
  const base = index * 4;
  return {
    x: flatArray[base],
    y: flatArray[base + 1],
    z: flatArray[base + 2],
  };
}

export function getPoint2D(flatArray, index) {
  const base = index * 3;
  return {
    x: flatArray[base],
    y: flatArray[base + 1],
    confidence: flatArray[base + 2],
  };
}

export function computePalmCenter3D(handFlatArray) {
  const indices = [0, 5, 9, 13, 17];
  let sum = { x: 0, y: 0, z: 0 };

  indices.forEach((index) => {
    sum = add(sum, getPoint3D(handFlatArray, index));
  });

  return scale(sum, 1 / indices.length);
}

export function computePalmCenter2D(handFlatArray) {
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

  return { x: sumX / count, y: sumY / count };
}

export function computeTorsoFrameFromPoseFlat(poseFlatArray) {
  const leftShoulder = datasetPointToWorld(getPoint3D(poseFlatArray, 5));
  const rightShoulder = datasetPointToWorld(getPoint3D(poseFlatArray, 2));
  const neck = datasetPointToWorld(getPoint3D(poseFlatArray, 1));
  const nose = datasetPointToWorld(getPoint3D(poseFlatArray, 0));
  const shoulderCenter = midpoint(leftShoulder, rightShoulder);
  const rawSide = sub(rightShoulder, leftShoulder);
  const side = normalize(projectOntoPlane(rawSide, WORLD_UP), { x: 1, y: 0, z: 0 });
  let forward = normalize(cross(WORLD_UP, side), { x: 0, y: 0, z: 1 });
  const noseHint = normalize(
    projectOntoPlane(sub(nose, neck), WORLD_UP),
    forward,
  );

  if (dot(forward, noseHint) < 0) {
    forward = scale(forward, -1);
  }

  return {
    origin: shoulderCenter,
    side,
    up: { ...WORLD_UP },
    forward,
    correctionForwardRaw: worldVectorToDataset(forward),
    shoulderWidth: Math.max(distance(leftShoulder, rightShoulder), 1e-6),
  };
}

function toLocal(point, torsoFrame) {
  const relative = sub(point, torsoFrame.origin);

  return {
    side: dot(relative, torsoFrame.side),
    up: dot(relative, torsoFrame.up),
    forward: dot(relative, torsoFrame.forward),
  };
}

function normalizeLocal(local, shoulderWidth) {
  return {
    side: local.side / shoulderWidth,
    up: local.up / shoulderWidth,
    forward: local.forward / shoulderWidth,
  };
}

function computeDirectionInTorsoSpace(from, to, torsoFrame) {
  const dir = normalize(sub(to, from), torsoFrame.forward);

  return {
    side: dot(dir, torsoFrame.side),
    up: dot(dir, torsoFrame.up),
    forward: dot(dir, torsoFrame.forward),
  };
}

export function computeTorsoBounds2D(frameData) {
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

export function computeTorsoOverlapSeverity2D(frameData, handKey) {
  const torsoBounds = computeTorsoBounds2D(frameData);
  const palmCenter = computePalmCenter2D(frameData.people[handKey]);

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

export function computeArmCorrectionFeaturesFromFrame(frameData, handSide) {
  const config = HAND_CONFIG[handSide];
  const poseFlat = frameData?.people?.pose_keypoints_3d;
  const handFlat = frameData?.people?.[config.hand3d];

  if (!Array.isArray(poseFlat) || !Array.isArray(handFlat) || handFlat.length < 21 * 4) {
    return null;
  }

  const shoulder = datasetPointToWorld(getPoint3D(poseFlat, config.pose.shoulder));
  const elbow = datasetPointToWorld(getPoint3D(poseFlat, config.pose.elbow));
  const wrist = datasetPointToWorld(getPoint3D(poseFlat, config.pose.wrist));
  const palm = datasetPointToWorld(computePalmCenter3D(handFlat));
  const torsoFrame = computeTorsoFrameFromPoseFlat(poseFlat);
  const shoulderWidth = torsoFrame.shoulderWidth;

  const palmLocal = toLocal(palm, torsoFrame);
  const wristLocal = toLocal(wrist, torsoFrame);
  const elbowLocal = toLocal(elbow, torsoFrame);
  const palmNorm = normalizeLocal(palmLocal, shoulderWidth);
  const wristNorm = normalizeLocal(wristLocal, shoulderWidth);
  const elbowNorm = normalizeLocal(elbowLocal, shoulderWidth);
  const upperArmDir = computeDirectionInTorsoSpace(shoulder, elbow, torsoFrame);
  const foreArmDir = computeDirectionInTorsoSpace(elbow, wrist, torsoFrame);
  const armLength = distance(shoulder, elbow) + distance(elbow, wrist);
  const extension = armLength > 1e-6 ? distance(shoulder, wrist) / armLength : 0;
  const torsoRisk = Number(
    Math.abs(palmNorm.side) < 0.72 &&
    palmNorm.up > -0.55 &&
    palmNorm.up < 0.55 &&
    palmNorm.forward < 0.22,
  );

  return {
    handSide,
    handSideSign: config.sideSign,
    shoulderWidth,
    torsoFrame,
    points: { shoulder, elbow, wrist, palm },
    locals: {
      palm: palmNorm,
      wrist: wristNorm,
      elbow: elbowNorm,
    },
    directions: {
      upperArm: upperArmDir,
      foreArm: foreArmDir,
    },
    armExtensionRatio: extension,
    torsoRisk,
  };
}

export function featureVectorFromMetrics(metrics) {
  return {
    palmForwardNorm: metrics.locals.palm.forward,
    palmSideNorm: metrics.locals.palm.side,
    palmUpNorm: metrics.locals.palm.up,
    wristForwardNorm: metrics.locals.wrist.forward,
    wristSideNorm: metrics.locals.wrist.side,
    wristUpNorm: metrics.locals.wrist.up,
    elbowForwardNorm: metrics.locals.elbow.forward,
    elbowSideNorm: metrics.locals.elbow.side,
    elbowUpNorm: metrics.locals.elbow.up,
    upperArmDirForward: metrics.directions.upperArm.forward,
    upperArmDirSide: metrics.directions.upperArm.side,
    upperArmDirUp: metrics.directions.upperArm.up,
    foreArmDirForward: metrics.directions.foreArm.forward,
    foreArmDirSide: metrics.directions.foreArm.side,
    foreArmDirUp: metrics.directions.foreArm.up,
    armExtensionRatio: metrics.armExtensionRatio,
    handSideSign: metrics.handSideSign,
    torsoRisk: metrics.torsoRisk,
  };
}

export function featureArrayFromVector(vector) {
  return FEATURE_NAMES.map((name) => vector[name] ?? 0);
}

export function computeCollisionLabel(frameDataF, viewFrames, handSide, options = {}) {
  const config = HAND_CONFIG[handSide];
  const metrics = computeArmCorrectionFeaturesFromFrame(frameDataF, handSide);

  if (!metrics) {
    return null;
  }

  const overlapByView = {};

  ['F', 'L', 'R', 'U', 'D'].forEach((view) => {
    const frame = viewFrames[view];
    overlapByView[view] = frame ? computeTorsoOverlapSeverity2D(frame, config.hand2d) : 0;
  });

  const sideOverlap = Math.max(overlapByView.L ?? 0, overlapByView.R ?? 0);
  const verticalOverlap = Math.max(overlapByView.U ?? 0, overlapByView.D ?? 0);
  const overlapWeight = clamp01(sideOverlap * 0.8 + verticalOverlap * 0.2);
  const centerBand = clamp01(1 - Math.abs(metrics.locals.palm.side) / 0.8);
  const wristDeficit = clamp01((0.12 - metrics.locals.wrist.forward) / 0.18);
  const palmDeficit = clamp01((0.16 - metrics.locals.palm.forward) / 0.22);
  const armRisk = palmDeficit * 0.55 + wristDeficit * 0.45;
  const collisionRisk = clamp01(overlapWeight * (0.55 + 0.45 * centerBand) * (0.55 + 0.45 * armRisk));
  const targetForwardNorm = 0.06 + overlapWeight * 0.18 + centerBand * 0.04;
  const wristForwardNorm = clamp01(Math.max(0, targetForwardNorm - metrics.locals.wrist.forward) * (0.8 + armRisk * 0.4));
  const epsilon = options.epsilon ?? CORRECTION_EPSILON;
  const wristForward = wristForwardNorm >= epsilon ? wristForwardNorm : 0;
  const elbowForward = wristForward > 0 ? clamp(wristForward * 0.55, 0, 0.24) : 0;

  return {
    sequenceId: options.sequenceId ?? null,
    frameNumber: options.frameNumber ?? null,
    handSide,
    handSideSign: metrics.handSideSign,
    overlapWeight,
    sideOverlap,
    verticalOverlap,
    collisionRisk,
    isCollisionRisk: Number(wristForward > 0 || collisionRisk >= 0.14),
    wristForwardNorm: wristForward,
    elbowForwardNorm: elbowForward,
    wristForward: wristForward * metrics.shoulderWidth,
    elbowForward: elbowForward * metrics.shoulderWidth,
  };
}

function makeRiskAxis(low, high) {
  const minValue = Math.min(low, high);
  const maxValue = Math.max(low, high);

  return {
    low: minValue,
    high: maxValue,
  };
}

function axisRisk(value, axis) {
  if (!axis || axis.high <= axis.low) {
    return 0;
  }

  return clamp01((axis.high - value) / (axis.high - axis.low));
}

export function buildRuleProfile(rows) {
  const positiveRows = rows.filter((row) => row.label.wristForwardNorm > 0);
  const negativeRows = rows.filter((row) => row.label.wristForwardNorm <= 0);
  const posPalmForward = positiveRows.map((row) => row.features.palmForwardNorm);
  const negPalmForward = negativeRows.map((row) => row.features.palmForwardNorm);
  const posWristForward = positiveRows.map((row) => row.features.wristForwardNorm);
  const negWristForward = negativeRows.map((row) => row.features.wristForwardNorm);
  const posElbowForward = positiveRows.map((row) => row.features.elbowForwardNorm);
  const negElbowForward = negativeRows.map((row) => row.features.elbowForwardNorm);
  const posPalmSide = positiveRows.map((row) => Math.abs(row.features.palmSideNorm));
  const negPalmSide = negativeRows.map((row) => Math.abs(row.features.palmSideNorm));
  const posWristSide = positiveRows.map((row) => Math.abs(row.features.wristSideNorm));
  const negWristSide = negativeRows.map((row) => Math.abs(row.features.wristSideNorm));
  const wristValues = positiveRows.map((row) => row.label.wristForwardNorm);
  const elbowValues = positiveRows.map((row) => row.label.elbowForwardNorm);
  const wristFloor = quantile(wristValues, 0.1) || 0.35;
  const wristCeiling = Math.max(wristFloor, quantile(wristValues, 0.6) || 1);
  const elbowFloor = quantile(elbowValues, 0.1) || Math.min(0.24, wristFloor * 0.55);
  const elbowCeiling = Math.max(elbowFloor, quantile(elbowValues, 0.6) || Math.min(0.24, wristCeiling * 0.55));

  return {
    epsilon: CORRECTION_EPSILON,
    activationThreshold: 0.16,
    exponent: 0.85,
    wristFloor,
    wristCeiling,
    elbowFloor,
    elbowCeiling,
    weights: {
      palmForward: 0.32,
      wristForward: 0.26,
      elbowForward: 0.10,
      palmSide: 0.12,
      wristSide: 0.10,
      torsoRisk: 0.10,
    },
    axes: {
      palmForward: makeRiskAxis(
        quantile(posPalmForward, 0.65),
        quantile(negPalmForward, 0.45),
      ),
      wristForward: makeRiskAxis(
        quantile(posWristForward, 0.65),
        quantile(negWristForward, 0.45),
      ),
      elbowForward: makeRiskAxis(
        quantile(posElbowForward, 0.7),
        quantile(negElbowForward, 0.45),
      ),
      palmSide: makeRiskAxis(
        quantile(posPalmSide, 0.75),
        quantile(negPalmSide, 0.35),
      ),
      wristSide: makeRiskAxis(
        quantile(posWristSide, 0.75),
        quantile(negWristSide, 0.35),
      ),
    },
  };
}

export function evaluateRuleCorrection(metrics, profile) {
  const palmForwardRisk = axisRisk(metrics.locals.palm.forward, profile.axes.palmForward);
  const wristForwardRisk = axisRisk(metrics.locals.wrist.forward, profile.axes.wristForward);
  const elbowForwardRisk = axisRisk(metrics.locals.elbow.forward, profile.axes.elbowForward);
  const palmSideRisk = axisRisk(Math.abs(metrics.locals.palm.side), profile.axes.palmSide);
  const wristSideRisk = axisRisk(Math.abs(metrics.locals.wrist.side), profile.axes.wristSide);
  const sideRisk = palmSideRisk * 0.6 + wristSideRisk * 0.4;
  const rawRisk = (
    palmForwardRisk * profile.weights.palmForward +
    wristForwardRisk * profile.weights.wristForward +
    elbowForwardRisk * profile.weights.elbowForward +
    sideRisk * (profile.weights.palmSide + profile.weights.wristSide) +
    metrics.torsoRisk * profile.weights.torsoRisk
  );
  const normalizedRisk = clamp01(
    (rawRisk - profile.activationThreshold) / Math.max(1e-6, 1 - profile.activationThreshold),
  );

  if (normalizedRisk <= 0) {
    return {
      mode: 'rule',
      risk: rawRisk,
      wristForwardNorm: 0,
      elbowForwardNorm: 0,
    };
  }

  const magnitude = Math.pow(normalizedRisk, profile.exponent);
  const wristFloor = profile.wristFloor ?? 0;
  const wristCeiling = profile.wristCeiling ?? profile.wristScale ?? 0;
  const elbowFloor = profile.elbowFloor ?? 0;
  const elbowCeiling = profile.elbowCeiling ?? profile.elbowScale ?? 0;

  return {
    mode: 'rule',
    risk: rawRisk,
    wristForwardNorm: clamp01(
      wristFloor + (wristCeiling - wristFloor) * magnitude,
    ),
    elbowForwardNorm: clamp01(
      elbowFloor + (elbowCeiling - elbowFloor) * magnitude,
    ),
  };
}

export function standardizeFeatureArray(featureArray, standardization) {
  return featureArray.map((value, index) => {
    const mean = standardization.means[index] ?? 0;
    const scaleValue = standardization.scales[index] ?? 1;
    return scaleValue > 1e-8 ? (value - mean) / scaleValue : value - mean;
  });
}

export function evaluateLinearCorrection(metrics, profile) {
  const vector = featureArrayFromVector(featureVectorFromMetrics(metrics));
  const normalized = standardizeFeatureArray(vector, profile.standardization);
  const logit = profile.classifier.bias + normalized.reduce(
    (sum, value, index) => sum + value * (profile.classifier.weights[index] ?? 0),
    0,
  );
  const probability = 1 / (1 + Math.exp(-logit));

  if (probability < profile.classifier.threshold) {
    return {
      mode: 'linear',
      probability,
      wristForwardNorm: 0,
      elbowForwardNorm: 0,
    };
  }

  const wrist = clamp01(profile.regressors.wrist.bias + normalized.reduce(
    (sum, value, index) => sum + value * (profile.regressors.wrist.weights[index] ?? 0),
    0,
  ));
  const elbow = clamp01(profile.regressors.elbow.bias + normalized.reduce(
    (sum, value, index) => sum + value * (profile.regressors.elbow.weights[index] ?? 0),
    0,
  ));

  return {
    mode: 'linear',
    probability,
    wristForwardNorm: wrist >= CORRECTION_EPSILON ? wrist : 0,
    elbowForwardNorm: wrist >= CORRECTION_EPSILON ? elbow : 0,
  };
}

export function evaluateCorrectionProfile(profile, metrics, mode = 'rule') {
  if (!profile || !metrics) {
    return { mode: 'none', wristForwardNorm: 0, elbowForwardNorm: 0 };
  }

  if (mode === 'linear' && profile.linear) {
    return evaluateLinearCorrection(metrics, profile.linear);
  }

  return evaluateRuleCorrection(metrics, profile.rule);
}

export function createSequenceSplit(sequenceIds) {
  const sorted = [...sequenceIds].sort();
  const trainCount = Math.max(1, Math.floor(sorted.length * 0.7));
  const validationCount = Math.max(1, Math.floor(sorted.length * 0.15));
  const train = sorted.slice(0, trainCount);
  const validation = sorted.slice(trainCount, trainCount + validationCount);
  const test = sorted.slice(trainCount + validationCount);

  return { train, validation, test };
}

export function evaluateBinaryMetrics(rows, predictions, field) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  rows.forEach((row, index) => {
    const actual = row.label[field] > 0;
    const predicted = predictions[index] > 0;

    if (actual && predicted) {
      tp += 1;
    } else if (!actual && predicted) {
      fp += 1;
    } else if (actual) {
      fn += 1;
    } else {
      tn += 1;
    }
  });

  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return { tp, fp, fn, tn, precision, recall, f1 };
}

export function evaluateRegressionMetrics(rows, predictions, field) {
  const errors = rows.map((row, index) => Math.abs(predictions[index] - row.label[field]));
  const actuals = rows.map((row) => row.label[field]);
  const mae = errors.reduce((sum, value) => sum + value, 0) / Math.max(1, errors.length);
  let overCorrection = 0;
  let underCorrection = 0;
  let positiveCount = 0;

  actuals.forEach((actual, index) => {
    if (actual <= CORRECTION_EPSILON) {
      return;
    }

    positiveCount += 1;
    const predicted = predictions[index];

    if (predicted > actual * 1.5) {
      overCorrection += 1;
    }

    if (predicted < actual * 0.5) {
      underCorrection += 1;
    }
  });

  return {
    mae,
    overCorrectionRate: overCorrection / Math.max(1, positiveCount),
    underCorrectionRate: underCorrection / Math.max(1, positiveCount),
  };
}

export function computeStandardization(rows) {
  const vectors = rows.map((row) => featureArrayFromVector(row.features));
  const means = FEATURE_NAMES.map((_, index) => (
    vectors.reduce((sum, vector) => sum + vector[index], 0) / Math.max(1, vectors.length)
  ));
  const scales = FEATURE_NAMES.map((_, index) => {
    const variance = vectors.reduce((sum, vector) => {
      const diff = vector[index] - means[index];
      return sum + diff * diff;
    }, 0) / Math.max(1, vectors.length);
    return Math.sqrt(variance) || 1;
  });

  return { means, scales };
}

export function trainLogisticClassifier(rows, standardization, labelField, options = {}) {
  const learningRate = options.learningRate ?? 0.06;
  const iterations = options.iterations ?? 500;
  const l2 = options.l2 ?? 0.001;
  const weights = new Array(FEATURE_NAMES.length).fill(0);
  let bias = 0;
  const normalizedVectors = rows.map((row) => standardizeFeatureArray(
    featureArrayFromVector(row.features),
    standardization,
  ));
  const labels = rows.map((row) => (row.label[labelField] > 0 ? 1 : 0));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradients = new Array(FEATURE_NAMES.length).fill(0);
    let biasGradient = 0;

    normalizedVectors.forEach((vector, rowIndex) => {
      const linear = bias + vector.reduce((sum, value, index) => sum + value * weights[index], 0);
      const prediction = 1 / (1 + Math.exp(-linear));
      const diff = prediction - labels[rowIndex];
      biasGradient += diff;

      vector.forEach((value, index) => {
        gradients[index] += diff * value;
      });
    });

    for (let index = 0; index < weights.length; index += 1) {
      weights[index] -= learningRate * ((gradients[index] / rows.length) + weights[index] * l2);
    }

    bias -= learningRate * (biasGradient / rows.length);
  }

  return { weights, bias };
}

export function tuneClassifierThreshold(rows, standardization, classifier, labelField) {
  let bestThreshold = 0.5;
  let bestScore = -Infinity;

  for (let threshold = 0.2; threshold <= 0.8; threshold += 0.02) {
    const predictions = rows.map((row) => {
      const normalized = standardizeFeatureArray(featureArrayFromVector(row.features), standardization);
      const linear = classifier.bias + normalized.reduce(
        (sum, value, index) => sum + value * classifier.weights[index],
        0,
      );
      const probability = 1 / (1 + Math.exp(-linear));
      return probability >= threshold ? 1 : 0;
    });
    const metrics = evaluateBinaryMetrics(rows, predictions, labelField);
    const score = metrics.f1 + metrics.recall * 0.15;

    if (score > bestScore) {
      bestScore = score;
      bestThreshold = Number(threshold.toFixed(2));
    }
  }

  return bestThreshold;
}

export function trainRidgeRegressor(rows, standardization, labelField, options = {}) {
  const learningRate = options.learningRate ?? 0.04;
  const iterations = options.iterations ?? 500;
  const l2 = options.l2 ?? 0.001;
  const weights = new Array(FEATURE_NAMES.length).fill(0);
  let bias = 0;
  const normalizedVectors = rows.map((row) => standardizeFeatureArray(
    featureArrayFromVector(row.features),
    standardization,
  ));
  const labels = rows.map((row) => row.label[labelField]);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradients = new Array(FEATURE_NAMES.length).fill(0);
    let biasGradient = 0;

    normalizedVectors.forEach((vector, rowIndex) => {
      const prediction = bias + vector.reduce((sum, value, index) => sum + value * weights[index], 0);
      const diff = prediction - labels[rowIndex];
      biasGradient += diff;

      vector.forEach((value, index) => {
        gradients[index] += diff * value;
      });
    });

    for (let index = 0; index < weights.length; index += 1) {
      weights[index] -= learningRate * ((gradients[index] / rows.length) + weights[index] * l2);
    }

    bias -= learningRate * (biasGradient / rows.length);
  }

  return { weights, bias };
}

export function buildLinearProfile(trainRows, validationRows) {
  const standardization = computeStandardization(trainRows);
  const classifier = trainLogisticClassifier(trainRows, standardization, 'wristForwardNorm');
  const threshold = tuneClassifierThreshold(validationRows, standardization, classifier, 'wristForwardNorm');
  const positiveTrainRows = trainRows.filter((row) => row.label.wristForwardNorm > CORRECTION_EPSILON);
  const regressors = {
    wrist: trainRidgeRegressor(positiveTrainRows, standardization, 'wristForwardNorm'),
    elbow: trainRidgeRegressor(positiveTrainRows, standardization, 'elbowForwardNorm'),
  };

  return {
    standardization,
    classifier: {
      ...classifier,
      threshold,
    },
    regressors,
  };
}
