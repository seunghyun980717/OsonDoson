import {
  COCO_BODY,
  COCO_FACE_START,
  COCO_HAND_COUNT,
  COCO_LEFT_HAND_START,
  COCO_RIGHT_HAND_START,
} from './coco-wholebody-map.js';

function confidence(point) {
  return point?.confidence ?? 0;
}

function distance2D(a, b) {
  if (!a || !b || confidence(a) <= 0 || confidence(b) <= 0) {
    return 0;
  }

  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function meanConfidence(points) {
  const visible = points.filter((point) => confidence(point) > 0);

  if (!visible.length) {
    return 0;
  }

  return visible.reduce((sum, point) => sum + point.confidence, 0) / visible.length;
}

export function estimateCocoBodyScale(cocoPoints) {
  const shoulderWidth = distance2D(
    cocoPoints[COCO_BODY.leftShoulder],
    cocoPoints[COCO_BODY.rightShoulder],
  );
  const hipWidth = distance2D(
    cocoPoints[COCO_BODY.leftHip],
    cocoPoints[COCO_BODY.rightHip],
  );
  const torsoHeight = distance2D(
    cocoPoints[COCO_BODY.leftShoulder],
    cocoPoints[COCO_BODY.leftHip],
  ) || distance2D(
    cocoPoints[COCO_BODY.rightShoulder],
    cocoPoints[COCO_BODY.rightHip],
  );

  return Math.max(shoulderWidth, hipWidth * 1.4, torsoHeight * 0.65, 1);
}

export function createPseudoDepthEstimator(cocoPoints, options = {}) {
  const scale = options.scale ?? estimateCocoBodyScale(cocoPoints);
  const baseDepth = options.baseDepth ?? 0;
  const handForwardDepth = options.handForwardDepth ?? -0.18;
  const wristForwardDepth = options.wristForwardDepth ?? -0.1;
  const faceForwardDepth = options.faceForwardDepth ?? -0.045;
  const elbowForwardDepth = options.elbowForwardDepth ?? -0.035;

  return function estimateDepth(point, semantic = {}) {
    if (!point || confidence(point) <= 0) {
      return 0;
    }

    if (semantic.kind === 'face') {
      return baseDepth + scale * faceForwardDepth;
    }

    if (semantic.kind === 'hand') {
      const progress = semantic.handIndex / Math.max(1, COCO_HAND_COUNT - 1);
      const fingerFan = semantic.handIndex === 0 ? 0 : clamp(progress, 0.15, 1);
      return baseDepth + scale * (handForwardDepth - fingerFan * 0.035);
    }

    if (semantic.body25Index === 3 || semantic.body25Index === 6) {
      return baseDepth + scale * elbowForwardDepth;
    }

    if (semantic.body25Index === 4 || semantic.body25Index === 7) {
      return baseDepth + scale * wristForwardDepth;
    }

    if (semantic.body25Index === 0 || semantic.body25Index === 15 || semantic.body25Index === 16) {
      return baseDepth + scale * faceForwardDepth;
    }

    return baseDepth;
  };
}

export function summarizeCocoWholeBodyConfidence(cocoPoints) {
  return {
    body: meanConfidence(cocoPoints.slice(0, COCO_FACE_START)),
    face: meanConfidence(cocoPoints.slice(COCO_FACE_START, COCO_LEFT_HAND_START)),
    leftHand: meanConfidence(cocoPoints.slice(COCO_LEFT_HAND_START, COCO_LEFT_HAND_START + COCO_HAND_COUNT)),
    rightHand: meanConfidence(cocoPoints.slice(COCO_RIGHT_HAND_START, COCO_RIGHT_HAND_START + COCO_HAND_COUNT)),
  };
}
