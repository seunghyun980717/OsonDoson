import {
  ARRAY_KEYS,
  POSE_LEFT_ELBOW_INDEX,
  POSE_LEFT_WRIST_INDEX,
  POSE_RIGHT_ELBOW_INDEX,
  POSE_RIGHT_WRIST_INDEX,
  cloneArrayFrames,
  cloneFramePoints,
  lerp,
  spatialDimsForArrayKey,
  vectorBetween,
  vectorNorm,
} from './keypoint-arrays.js';

const TAIL_SAMPLES = 4;
const WRIST_BLEND_POSE = 0.35;
const WRIST_BLEND_HAND = 0.65;
const STRONG_CLAMP_SCALE = 0.55;
const SHORT_TRANSITION_FRAMES = 4;
const SPEED_RATIO_LIMIT = 2.4;
const TERMINAL_DISCONTINUITY_LIMIT = 0.9;
const BILATERAL_SPREAD_MARGIN = 0.65;
const TRANSITION_METHODS = new Set(['linear', 'smoothstep', 'hermite', 'catmull_rom', 'bezier']);
const JOINT_MARGIN_BY_KIND = Object.freeze({
  wrist: [0.35, 0.28, 0.28],
  elbow: [0.28, 0.22, 0.22],
});
const TRANSITION_CHECK_JOINTS = Object.freeze([
  ['left_wrist', POSE_LEFT_WRIST_INDEX, 'wrist'],
  ['right_wrist', POSE_RIGHT_WRIST_INDEX, 'wrist'],
  ['left_elbow', POSE_LEFT_ELBOW_INDEX, 'elbow'],
  ['right_elbow', POSE_RIGHT_ELBOW_INDEX, 'elbow'],
]);

function smoothstep(t) {
  return t * t * (3 - (2 * t));
}

function frameCount(clip) {
  return clip.arrays?.pose_3d?.length || 0;
}

function transitionWeights(transitionFrames) {
  return Array.from({ length: transitionFrames }, (_, index) => (index + 1) / (transitionFrames + 1));
}

function maxSupportedTransitionFrames(prevClip, nextClip) {
  const shortestClip = Math.min(frameCount(prevClip), frameCount(nextClip));
  if (shortestClip <= 2) {
    return 2;
  }
  return Math.max(2, shortestClip - 1);
}

function resolveTransitionFrames(prevClip, nextClip, requestedFrames) {
  if (requestedFrames != null) {
    return Math.max(1, Math.min(Math.floor(Number(requestedFrames) || 1), maxSupportedTransitionFrames(prevClip, nextClip)));
  }

  const fps = Number(prevClip.fps || nextClip.fps) || 30;
  const defaultFrames = Math.round(0.25 * fps);
  return Math.min(Math.max(6, Math.min(10, defaultFrames)), maxSupportedTransitionFrames(prevClip, nextClip));
}

function resolveShortTransitionFrames(prevClip, nextClip) {
  return Math.min(SHORT_TRANSITION_FRAMES, maxSupportedTransitionFrames(prevClip, nextClip));
}

function interpolateSpatialPoint(p0, p1, p2, p3, t, method, dims) {
  const result = [...p1];

  for (let axis = 0; axis < dims; axis += 1) {
    if (method === 'linear') {
      result[axis] = lerp(p1[axis], p2[axis], t);
    } else if (method === 'smoothstep') {
      result[axis] = lerp(p1[axis], p2[axis], smoothstep(t));
    } else if (method === 'hermite') {
      const m0 = p1[axis] - p0[axis];
      const m1 = p3[axis] - p2[axis];
      const t2 = t * t;
      const t3 = t2 * t;
      result[axis] =
        ((2 * t3 - 3 * t2 + 1) * p1[axis])
        + ((t3 - 2 * t2 + t) * m0)
        + ((-2 * t3 + 3 * t2) * p2[axis])
        + ((t3 - t2) * m1);
    } else if (method === 'catmull_rom') {
      const t2 = t * t;
      const t3 = t2 * t;
      result[axis] = 0.5 * (
        (2 * p1[axis])
        + ((-p0[axis] + p2[axis]) * t)
        + ((2 * p0[axis] - 5 * p1[axis] + 4 * p2[axis] - p3[axis]) * t2)
        + ((-p0[axis] + 3 * p1[axis] - 3 * p2[axis] + p3[axis]) * t3)
      );
    } else if (method === 'bezier') {
      const c0 = p1[axis];
      const c1 = p1[axis] + ((p1[axis] - p0[axis]) / 3);
      const c2 = p2[axis] - ((p3[axis] - p2[axis]) / 3);
      const c3 = p2[axis];
      const omt = 1 - t;
      result[axis] =
        (omt * omt * omt * c0)
        + (3 * omt * omt * t * c1)
        + (3 * omt * t * t * c2)
        + (t * t * t * c3);
    }
  }

  for (let axis = dims; axis < result.length; axis += 1) {
    result[axis] = lerp(p1[axis], p2[axis], t);
  }

  return result;
}

function interpolateFrames(prevFrames, nextFrames, transitionFrames, method, dims) {
  const prevFrame = prevFrames[prevFrames.length - 1] || [];
  const nextFrame = nextFrames[0] || [];
  const prevPrevFrame = prevFrames[Math.max(0, prevFrames.length - 2)] || prevFrame;
  const nextNextFrame = nextFrames[Math.min(nextFrames.length - 1, 1)] || nextFrame;
  const pointCount = Math.min(prevFrame.length, nextFrame.length);
  const weights = transitionWeights(transitionFrames);

  return weights.map((weight) =>
    Array.from({ length: pointCount }, (_, pointIndex) =>
      interpolateSpatialPoint(
        prevPrevFrame[pointIndex] || prevFrame[pointIndex],
        prevFrame[pointIndex],
        nextFrame[pointIndex],
        nextNextFrame[pointIndex] || nextFrame[pointIndex],
        weight,
        method,
        dims,
      ),
    ),
  );
}

function estimateLimits(prevFrame, prevPrevFrame, nextFrame, nextNextFrame, dims) {
  return prevFrame.map((point, index) => {
    const prevStep = vectorNorm(vectorBetween(prevPrevFrame[index] || point, point, dims));
    const nextStep = vectorNorm(vectorBetween(nextFrame[index], nextNextFrame[index] || nextFrame[index], dims));
    return Math.max(prevStep, nextStep, 1e-4) * 1.5;
  });
}

function applyVelocityClamp(frames, limits, dims) {
  const clamped = cloneArrayFrames(frames);
  for (let frameIndex = 1; frameIndex < clamped.length; frameIndex += 1) {
    const previous = clamped[frameIndex - 1];
    const current = clamped[frameIndex];
    current.forEach((point, pointIndex) => {
      const delta = vectorBetween(previous[pointIndex], point, dims);
      const norm = vectorNorm(delta);
      const limit = limits[pointIndex] ?? Number.POSITIVE_INFINITY;
      if (norm > limit) {
        const ratio = limit / norm;
        for (let axis = 0; axis < dims; axis += 1) {
          point[axis] = previous[pointIndex][axis] + (delta[axis] * ratio);
        }
      }
    });
  }
  return clamped;
}

function interpolateArray(prevClip, nextClip, key, transitionFrames, method) {
  const prevFrames = prevClip.arrays[key] || [];
  const nextFrames = nextClip.arrays[key] || [];
  const dims = spatialDimsForArrayKey(key);
  let interpolated = interpolateFrames(prevFrames, nextFrames, transitionFrames, method, dims);

  if (dims === 3) {
    const prevFrame = prevFrames[prevFrames.length - 1] || [];
    const nextFrame = nextFrames[0] || [];
    const prevPrevFrame = prevFrames[Math.max(0, prevFrames.length - 2)] || prevFrame;
    const nextNextFrame = nextFrames[Math.min(nextFrames.length - 1, 1)] || nextFrame;
    interpolated = applyVelocityClamp(
      interpolated,
      estimateLimits(prevFrame, prevPrevFrame, nextFrame, nextNextFrame, dims),
      dims,
    );
  }

  return interpolated;
}

function shoulderCenterAndWidth(poseFrames) {
  return {
    centers: poseFrames.map((poseFrame) => {
      const left = poseFrame[5] || [0, 0, 0];
      const right = poseFrame[2] || [0, 0, 0];
      return [0, 1, 2].map((axis) => ((left[axis] || 0) + (right[axis] || 0)) * 0.5);
    }),
    widths: poseFrames.map((poseFrame) => {
      const left = poseFrame[5] || [0, 0, 0];
      const right = poseFrame[2] || [0, 0, 0];
      return Math.max(vectorNorm(vectorBetween(right, left, 3)), 1e-3);
    }),
  };
}

function normalizeJointPositions(poseFrames, jointIndex) {
  const { centers, widths } = shoulderCenterAndWidth(poseFrames);
  return poseFrames.map((poseFrame, frameIndex) =>
    [0, 1, 2].map((axis) => ((poseFrame[jointIndex]?.[axis] || 0) - centers[frameIndex][axis]) / widths[frameIndex]),
  );
}

function denormalizeJointPositions(poseFrames, normalized) {
  const { centers, widths } = shoulderCenterAndWidth(poseFrames);
  return normalized.map((point, frameIndex) =>
    [0, 1, 2].map((axis) => centers[frameIndex][axis] + (point[axis] * widths[frameIndex])),
  );
}

function clampNormalizedSeries(series, prevPoint, nextPoint, jointKind, clampScale) {
  const margin = JOINT_MARGIN_BY_KIND[jointKind].map((value) => value * clampScale);
  let maxDelta = 0;
  let axisName = 'x';
  const clamped = series.map((point) =>
    point.map((value, axis) => {
      const lower = Math.min(prevPoint[axis], nextPoint[axis]) - margin[axis];
      const upper = Math.max(prevPoint[axis], nextPoint[axis]) + margin[axis];
      const nextValue = Math.min(Math.max(value, lower), upper);
      const delta = Math.abs(nextValue - value);
      if (delta > maxDelta) {
        maxDelta = delta;
        axisName = ['x', 'y', 'z'][axis];
      }
      return nextValue;
    }),
  );

  return { axisName, clamped, maxDelta };
}

function applyNormalizedConstraints(poseFrames, prevPose, nextPose, clampScale) {
  const constrained = cloneArrayFrames(poseFrames);
  const clampInfo = {};

  TRANSITION_CHECK_JOINTS.forEach(([jointName, jointIndex, jointKind]) => {
    const series = normalizeJointPositions(constrained, jointIndex);
    const prevPoint = normalizeJointPositions([prevPose], jointIndex)[0];
    const nextPoint = normalizeJointPositions([nextPose], jointIndex)[0];
    const { clamped, maxDelta, axisName } = clampNormalizedSeries(series, prevPoint, nextPoint, jointKind, clampScale);
    const denormalized = denormalizeJointPositions(constrained, clamped);
    denormalized.forEach((point, frameIndex) => {
      for (let axis = 0; axis < 3; axis += 1) {
        constrained[frameIndex][jointIndex][axis] = point[axis];
      }
    });
    clampInfo[jointName] = { max_delta: maxDelta, axis: axisName };
  });

  const leftWrist = normalizeJointPositions(constrained, POSE_LEFT_WRIST_INDEX);
  const rightWrist = normalizeJointPositions(constrained, POSE_RIGHT_WRIST_INDEX);
  const prevLeft = normalizeJointPositions([prevPose], POSE_LEFT_WRIST_INDEX)[0];
  const prevRight = normalizeJointPositions([prevPose], POSE_RIGHT_WRIST_INDEX)[0];
  const nextLeft = normalizeJointPositions([nextPose], POSE_LEFT_WRIST_INDEX)[0];
  const nextRight = normalizeJointPositions([nextPose], POSE_RIGHT_WRIST_INDEX)[0];
  const endpointSpread = Math.max(Math.abs(prevLeft[0]) + Math.abs(prevRight[0]), Math.abs(nextLeft[0]) + Math.abs(nextRight[0]));
  const maxSpread = endpointSpread + (BILATERAL_SPREAD_MARGIN * clampScale);
  let maxSpreadDelta = 0;

  leftWrist.forEach((left, frameIndex) => {
    const right = rightWrist[frameIndex];
    const spread = Math.abs(left[0]) + Math.abs(right[0]);
    if (spread <= maxSpread) {
      return;
    }
    const ratio = maxSpread / Math.max(spread, 1e-4);
    maxSpreadDelta = Math.max(maxSpreadDelta, spread - maxSpread);
    left[0] *= ratio;
    right[0] *= ratio;
  });

  const denormLeft = denormalizeJointPositions(constrained, leftWrist);
  const denormRight = denormalizeJointPositions(constrained, rightWrist);
  denormLeft.forEach((point, frameIndex) => {
    for (let axis = 0; axis < 3; axis += 1) {
      constrained[frameIndex][POSE_LEFT_WRIST_INDEX][axis] = point[axis];
      constrained[frameIndex][POSE_RIGHT_WRIST_INDEX][axis] = denormRight[frameIndex][axis];
    }
  });
  clampInfo.bilateral_spread = { max_delta: maxSpreadDelta, axis: 'x' };

  return { clampInfo, poseFrames: constrained };
}

function canonicalWrist(poseFrame, handFrame, wristIndex) {
  return [0, 1, 2].map((axis) =>
    (WRIST_BLEND_POSE * (poseFrame[wristIndex]?.[axis] || 0))
    + (WRIST_BLEND_HAND * (handFrame[0]?.[axis] || 0)),
  );
}

function applyWristAnchor(poseFrames, handFrames, prevPose, nextPose, prevHand, nextHand, wristIndex, clampScale) {
  const anchoredPose = cloneArrayFrames(poseFrames);
  const anchoredHand = cloneArrayFrames(handFrames);
  const prevCanonical = canonicalWrist(prevPose, prevHand, wristIndex);
  const nextCanonical = canonicalWrist(nextPose, nextHand, wristIndex);
  const prevOffsets = prevHand.map((point) => vectorBetween(prevHand[0], point, 3));
  const nextOffsets = nextHand.map((point) => vectorBetween(nextHand[0], point, 3));
  const prevNorm = normalizeJointPositions([prevPose], wristIndex)[0];
  const nextNorm = normalizeJointPositions([nextPose], wristIndex)[0];

  anchoredPose.forEach((poseFrame, frameIndex) => {
    const eased = smoothstep((frameIndex + 1) / (anchoredPose.length + 1));
    let canonicalPath = prevCanonical.map((value, axis) => lerp(value, nextCanonical[axis], eased));
    poseFrame[wristIndex].splice(0, 3, ...canonicalPath);

    const { clamped } = clampNormalizedSeries(
      normalizeJointPositions([poseFrame], wristIndex),
      prevNorm,
      nextNorm,
      'wrist',
      clampScale,
    );
    canonicalPath = denormalizeJointPositions([poseFrame], clamped)[0];
    poseFrame[wristIndex].splice(0, 3, ...canonicalPath);
    anchoredHand[frameIndex][0].splice(0, 3, ...canonicalPath);

    anchoredHand[frameIndex].forEach((point, pointIndex) => {
      const offset = prevOffsets[pointIndex].map((value, axis) => lerp(value, nextOffsets[pointIndex]?.[axis] ?? value, eased));
      for (let axis = 0; axis < 3; axis += 1) {
        point[axis] = canonicalPath[axis] + offset[axis];
      }
    });
  });

  return [anchoredPose, anchoredHand];
}

function buildTransitionClip(prevClip, nextClip, transitionFrames, clampScale, method) {
  const arrays = {};
  ARRAY_KEYS.forEach((key) => {
    arrays[key] = interpolateArray(prevClip, nextClip, key, transitionFrames, method);
  });

  const prevPose = prevClip.arrays.pose_3d[prevClip.arrays.pose_3d.length - 1];
  const nextPose = nextClip.arrays.pose_3d[0];
  [arrays.pose_3d, arrays.left_hand_3d] = applyWristAnchor(
    arrays.pose_3d,
    arrays.left_hand_3d,
    prevPose,
    nextPose,
    prevClip.arrays.left_hand_3d[prevClip.arrays.left_hand_3d.length - 1],
    nextClip.arrays.left_hand_3d[0],
    POSE_LEFT_WRIST_INDEX,
    clampScale,
  );
  [arrays.pose_3d, arrays.right_hand_3d] = applyWristAnchor(
    arrays.pose_3d,
    arrays.right_hand_3d,
    prevPose,
    nextPose,
    prevClip.arrays.right_hand_3d[prevClip.arrays.right_hand_3d.length - 1],
    nextClip.arrays.right_hand_3d[0],
    POSE_RIGHT_WRIST_INDEX,
    clampScale,
  );

  const constrained = applyNormalizedConstraints(arrays.pose_3d, prevPose, nextPose, clampScale);
  arrays.pose_3d = constrained.poseFrames;

  return {
    id: `${prevClip.label}__${nextClip.label}__generated`,
    label: `${prevClip.label}->${nextClip.label}`,
    fps: prevClip.fps,
    source: 'transition',
    path: null,
    arrays,
    meta: {
      transition_clamp_info: constrained.clampInfo,
      transition_frame_count: transitionFrames,
      transition_clamp_scale: clampScale,
      transition_method: method,
    },
  };
}

function jointSpeedRatio(prevClip, nextClip, transitionClip, jointIndex) {
  const prevSeries = normalizeJointPositions(prevClip.arrays.pose_3d, jointIndex).slice(-TAIL_SAMPLES);
  const nextSeries = normalizeJointPositions(nextClip.arrays.pose_3d, jointIndex).slice(0, TAIL_SAMPLES);
  const transitionSeries = normalizeJointPositions(transitionClip.arrays.pose_3d, jointIndex);
  const deltas = (series) => series.slice(1).map((point, index) => vectorNorm(vectorBetween(series[index], point, 3)));
  const baseline = Math.max(...deltas(prevSeries), ...deltas(nextSeries), 1e-4);
  return Math.max(...deltas(transitionSeries), 0) / baseline;
}

export function evaluateTransitionQuality(prevClip, nextClip, transitionClip) {
  const failedChecks = new Set();
  let maxOvershoot = 0;
  let maxOvershootJoint = '';
  let maxOvershootAxis = 'x';
  let maxSpeedRatio = 0;
  let terminalDiscontinuity = 0;

  TRANSITION_CHECK_JOINTS.forEach(([jointName, jointIndex, jointKind]) => {
    const transitionSeries = normalizeJointPositions(transitionClip.arrays.pose_3d, jointIndex);
    const prevPoint = normalizeJointPositions([prevClip.arrays.pose_3d[prevClip.arrays.pose_3d.length - 1]], jointIndex)[0];
    const nextPoint = normalizeJointPositions([nextClip.arrays.pose_3d[0]], jointIndex)[0];
    const margin = JOINT_MARGIN_BY_KIND[jointKind];

    transitionSeries.forEach((point) => {
      point.forEach((value, axis) => {
        const lower = Math.min(prevPoint[axis], nextPoint[axis]) - margin[axis];
        const upper = Math.max(prevPoint[axis], nextPoint[axis]) + margin[axis];
        const overshoot = Math.max(lower - value, value - upper, 0);
        if (overshoot > maxOvershoot) {
          maxOvershoot = overshoot;
          maxOvershootJoint = jointName;
          maxOvershootAxis = ['x', 'y', 'z'][axis];
        }
      });
    });

    maxSpeedRatio = Math.max(maxSpeedRatio, jointSpeedRatio(prevClip, nextClip, transitionClip, jointIndex));
    const transitionEnd = transitionSeries[transitionSeries.length - 1];
    terminalDiscontinuity = Math.max(terminalDiscontinuity, vectorNorm(vectorBetween(transitionEnd, nextPoint, 3)));
  });

  const leftTransition = normalizeJointPositions(transitionClip.arrays.pose_3d, POSE_LEFT_WRIST_INDEX);
  const rightTransition = normalizeJointPositions(transitionClip.arrays.pose_3d, POSE_RIGHT_WRIST_INDEX);
  const leftPrev = normalizeJointPositions([prevClip.arrays.pose_3d[prevClip.arrays.pose_3d.length - 1]], POSE_LEFT_WRIST_INDEX)[0];
  const rightPrev = normalizeJointPositions([prevClip.arrays.pose_3d[prevClip.arrays.pose_3d.length - 1]], POSE_RIGHT_WRIST_INDEX)[0];
  const leftNext = normalizeJointPositions([nextClip.arrays.pose_3d[0]], POSE_LEFT_WRIST_INDEX)[0];
  const rightNext = normalizeJointPositions([nextClip.arrays.pose_3d[0]], POSE_RIGHT_WRIST_INDEX)[0];
  const endpointSpread = Math.max(Math.abs(leftPrev[0]) + Math.abs(rightPrev[0]), Math.abs(leftNext[0]) + Math.abs(rightNext[0]));
  const bilateralSpreadIncrease = Math.max(
    ...leftTransition.map((left, index) =>
      Math.max((Math.abs(left[0]) + Math.abs(rightTransition[index][0])) - (endpointSpread + BILATERAL_SPREAD_MARGIN), 0),
    ),
    0,
  );

  if (maxOvershoot > 0) failedChecks.add('overshoot');
  if (maxSpeedRatio > SPEED_RATIO_LIMIT) failedChecks.add('speed');
  if (terminalDiscontinuity > TERMINAL_DISCONTINUITY_LIMIT) failedChecks.add('terminal');
  if (bilateralSpreadIncrease > 0) failedChecks.add('bilateral_spread');

  return {
    passed: failedChecks.size === 0,
    failed_checks: [...failedChecks],
    max_overshoot: maxOvershoot,
    max_overshoot_joint: maxOvershootJoint,
    max_overshoot_axis: maxOvershootAxis,
    max_speed_ratio: maxSpeedRatio,
    terminal_discontinuity: terminalDiscontinuity,
    bilateral_spread_increase: bilateralSpreadIncrease,
  };
}

function withTransitionDiagnostics(clip, attempts) {
  const finalAttempt = attempts[attempts.length - 1];
  return {
    ...clip,
    meta: {
      ...(clip.meta || {}),
      transition_diagnostics: {
        attempts,
        final_strategy: finalAttempt?.strategy ?? 'unknown',
        retry_count: attempts.filter((attempt) => attempt.strategy === 'strong-clamp').length,
        fallback_count: finalAttempt?.strategy === 'short-transition' ? 1 : 0,
        quality_failures: attempts.filter((attempt) => !attempt.quality?.passed).length,
        passed: Boolean(finalAttempt?.quality?.passed),
      },
    },
  };
}

export function generateTransition(prevClip, nextClip, options = {}) {
  const method = options.method ?? 'smoothstep';
  if (!TRANSITION_METHODS.has(method)) {
    throw new Error(`Unsupported transition method: ${method}`);
  }

  const requestedFrames = options.transitionFrames;
  const allowFallback = options.allowFallback ?? requestedFrames == null;
  const baseFrames = resolveTransitionFrames(prevClip, nextClip, requestedFrames);
  const attempts = [];
  const baseClip = buildTransitionClip(prevClip, nextClip, baseFrames, 1.0, method);
  const baseQuality = evaluateTransitionQuality(prevClip, nextClip, baseClip);
  attempts.push({ strategy: 'base', method, frame_count: baseFrames, quality: baseQuality });

  if (baseQuality.passed || !allowFallback) {
    return withTransitionDiagnostics(baseClip, attempts);
  }

  const strongClip = buildTransitionClip(prevClip, nextClip, baseFrames, STRONG_CLAMP_SCALE, method);
  const strongQuality = evaluateTransitionQuality(prevClip, nextClip, strongClip);
  attempts.push({ strategy: 'strong-clamp', method, frame_count: baseFrames, quality: strongQuality });

  if (strongQuality.passed || requestedFrames != null) {
    return withTransitionDiagnostics(strongClip, attempts);
  }

  const shortFrames = resolveShortTransitionFrames(prevClip, nextClip);
  const shortClip = buildTransitionClip(prevClip, nextClip, shortFrames, STRONG_CLAMP_SCALE, method);
  const shortQuality = evaluateTransitionQuality(prevClip, nextClip, shortClip);
  attempts.push({ strategy: 'short-transition', method, frame_count: shortFrames, quality: shortQuality });
  return withTransitionDiagnostics(shortClip, attempts);
}
