import {
  buildBody25Points,
  parseCocoWholeBodyKeypoints,
  pointsToOpenPose2D,
  sliceFacePoints,
  sliceHandPoints,
} from './coco-wholebody-map.js';
import {
  createPseudoDepthEstimator,
  estimateCocoBodyScale,
  summarizeCocoWholeBodyConfidence,
} from './pseudo-depth.js';

function pointsToOpenPose3D(points, estimateDepth, semanticForIndex) {
  return points.flatMap((point, index) => [
    point?.x ?? 0,
    point?.y ?? 0,
    estimateDepth(point, semanticForIndex(index)),
    point?.confidence ?? 0,
  ]);
}

export function convertCocoWholeBodyKeypointsToFrameData(flatKeypoints, options = {}) {
  const cocoPoints = parseCocoWholeBodyKeypoints(flatKeypoints);
  const body25 = buildBody25Points(cocoPoints);
  const face = sliceFacePoints(cocoPoints);
  const leftHand = sliceHandPoints(cocoPoints, 'left');
  const rightHand = sliceHandPoints(cocoPoints, 'right');
  const scale = estimateCocoBodyScale(cocoPoints);
  const estimateDepth = createPseudoDepthEstimator(cocoPoints, {
    ...options.depth,
    scale,
  });

  return {
    version: 1.3,
    people: {
      person_id: options.personId ?? -1,
      face_keypoints_2d: pointsToOpenPose2D(face),
      pose_keypoints_2d: pointsToOpenPose2D(body25),
      hand_left_keypoints_2d: pointsToOpenPose2D(leftHand),
      hand_right_keypoints_2d: pointsToOpenPose2D(rightHand),
      face_keypoints_3d: pointsToOpenPose3D(face, estimateDepth, (index) => ({
        kind: 'face',
        faceIndex: index,
      })),
      pose_keypoints_3d: pointsToOpenPose3D(body25, estimateDepth, (index) => ({
        kind: 'body',
        body25Index: index,
      })),
      hand_left_keypoints_3d: pointsToOpenPose3D(leftHand, estimateDepth, (index) => ({
        kind: 'hand',
        side: 'left',
        handIndex: index,
      })),
      hand_right_keypoints_3d: pointsToOpenPose3D(rightHand, estimateDepth, (index) => ({
        kind: 'hand',
        side: 'right',
        handIndex: index,
      })),
    },
    cocoWholeBody25d: {
      source: 'COCO-WholeBody',
      keypointCount: cocoPoints.length,
      depth: 'pseudo',
      scale,
      confidence: summarizeCocoWholeBodyConfidence(cocoPoints),
    },
  };
}

export function extractCocoWholeBodyFrameEntries(input) {
  const sourceFrames = Array.isArray(input)
    ? input
    : input?.landmarks ?? input?.frames ?? input?.annotations ?? [input];

  if (!Array.isArray(sourceFrames)) {
    throw new TypeError('Input JSON must be an object, an array, or contain landmarks/frames/annotations.');
  }

  return sourceFrames
    .map((entry, index) => {
      const prediction = entry?.predictions?.[0] ?? entry?.prediction ?? entry;
      const keypoints = prediction?.keypoints ?? entry?.keypoints;

      return {
        index,
        frameNumber: Number(entry?.frame_number ?? entry?.frameNumber ?? entry?.frame_index ?? index),
        keypoints,
        source: entry,
      };
    })
    .filter((entry) => Array.isArray(entry.keypoints));
}

export function convertCocoWholeBodySequence(input, options = {}) {
  const entries = extractCocoWholeBodyFrameEntries(input);

  return entries.map((entry, outputIndex) => ({
    outputIndex,
    frameNumber: entry.frameNumber,
    frameData: convertCocoWholeBodyKeypointsToFrameData(entry.keypoints, options),
  }));
}
