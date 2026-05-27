export const COCO_WHOLEBODY_KEYPOINT_COUNT = 133;
export const COCO_WHOLEBODY_STRIDE = 3;

export const COCO_BODY = Object.freeze({
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

export const COCO_FACE_START = 23;
export const COCO_FACE_COUNT = 68;
export const COCO_LEFT_HAND_START = 91;
export const COCO_RIGHT_HAND_START = 112;
export const COCO_HAND_COUNT = 21;

export const BODY_25_COUNT = 25;
export const OPENPOSE_FACE_COUNT = 68;
export const OPENPOSE_HAND_COUNT = 21;

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

export function parseCocoWholeBodyKeypoints(flatKeypoints) {
  if (!Array.isArray(flatKeypoints)) {
    throw new TypeError('COCO-WholeBody keypoints must be a flat array.');
  }

  if (flatKeypoints.length < COCO_WHOLEBODY_KEYPOINT_COUNT * COCO_WHOLEBODY_STRIDE) {
    throw new Error(
      `Expected at least ${COCO_WHOLEBODY_KEYPOINT_COUNT * COCO_WHOLEBODY_STRIDE} COCO-WholeBody values, received ${flatKeypoints.length}.`,
    );
  }

  return Array.from({ length: COCO_WHOLEBODY_KEYPOINT_COUNT }, (_, index) => {
    const base = index * COCO_WHOLEBODY_STRIDE;
    return {
      x: Number(flatKeypoints[base]) || 0,
      y: Number(flatKeypoints[base + 1]) || 0,
      confidence: Number(flatKeypoints[base + 2]) || 0,
      sourceIndex: index,
    };
  });
}

export function emptyPoint(sourceIndex = null) {
  return {
    x: 0,
    y: 0,
    confidence: 0,
    sourceIndex,
  };
}

export function averagePoints(points, sourceIndex = null) {
  const visible = points.filter((point) => point && point.confidence > 0);

  if (!visible.length) {
    return emptyPoint(sourceIndex);
  }

  const sum = visible.reduce(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
      confidence: acc.confidence + point.confidence,
    }),
    { x: 0, y: 0, confidence: 0 },
  );

  return {
    x: sum.x / visible.length,
    y: sum.y / visible.length,
    confidence: sum.confidence / visible.length,
    sourceIndex,
  };
}

export function buildBody25Points(cocoPoints) {
  const body25 = BODY_25_TO_COCO.map((cocoIndex) =>
    cocoIndex === null ? emptyPoint() : cocoPoints[cocoIndex] ?? emptyPoint(cocoIndex),
  );

  body25[1] = averagePoints(
    [cocoPoints[COCO_BODY.leftShoulder], cocoPoints[COCO_BODY.rightShoulder]],
    'neck',
  );
  body25[8] = averagePoints(
    [cocoPoints[COCO_BODY.leftHip], cocoPoints[COCO_BODY.rightHip]],
    'midHip',
  );

  return body25;
}

export function sliceFacePoints(cocoPoints) {
  return cocoPoints.slice(COCO_FACE_START, COCO_FACE_START + COCO_FACE_COUNT);
}

export function sliceHandPoints(cocoPoints, side) {
  const start = side === 'left' ? COCO_LEFT_HAND_START : COCO_RIGHT_HAND_START;
  return cocoPoints.slice(start, start + COCO_HAND_COUNT);
}

export function pointsToOpenPose2D(points) {
  return points.flatMap((point) => [
    point?.x ?? 0,
    point?.y ?? 0,
    point?.confidence ?? 0,
  ]);
}
