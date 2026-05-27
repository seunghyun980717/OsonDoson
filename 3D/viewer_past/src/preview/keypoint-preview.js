const PREVIEW_BACKGROUND = '#020617';

const POSE_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [1, 5], [5, 6], [6, 7], [1, 8],
  [8, 9], [9, 10], [10, 11],
  [8, 12], [12, 13], [13, 14],
];

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function configureFaceCanvas(canvas) {
  const size = 320;
  canvas.width = size;
  canvas.height = size;
}

function parse2DKeypoints(flatArray) {
  const points = [];

  for (let i = 0; i < flatArray.length; i += 3) {
    points.push({
      x: flatArray[i],
      y: flatArray[i + 1],
      confidence: flatArray[i + 2],
    });
  }

  return points;
}

function correctionsForFrame(frameData) {
  const block = frameData?.keypoint_corrections;
  if (!block || !Array.isArray(block.items)) {
    return [];
  }

  return block.items.filter((item) => (
    item
    && typeof item.part === 'string'
    && Number.isInteger(item.joint)
    && Array.isArray(item.to)
    && item.to.length >= 2
  ));
}

function correctionPartColor(part) {
  if (part === 'left_hand') {
    return '#f59e0b';
  }
  if (part === 'right_hand') {
    return '#22d3ee';
  }
  if (part === 'pose') {
    return '#f472b6';
  }
  return '#a78bfa';
}

function getFaceBounds(facePoints, sourceWidth, sourceHeight) {
  const validPoints = facePoints.filter((point) => point && point.confidence > 0);

  if (!validPoints.length) {
    return null;
  }

  const xs = validPoints.map((point) => point.x);
  const ys = validPoints.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const size = Math.max(maxX - minX, maxY - minY) * 1.8;

  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  const clampedSize = Math.min(size, sourceWidth, sourceHeight);
  const x = clamp(centerX - clampedSize * 0.5, 0, Math.max(0, sourceWidth - clampedSize));
  const y = clamp(centerY - clampedSize * 0.5, 0, Math.max(0, sourceHeight - clampedSize));

  return { x, y, size: clampedSize };
}

function fillPreviewBackground(context, canvas) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = PREVIEW_BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

export function createKeypointPreview({
  keypointCanvas,
  referenceVideoEl,
  referenceFaceCanvas,
  keypointFaceCanvas,
}) {
  const keypointContext = keypointCanvas.getContext('2d');
  const referenceFaceContext = referenceFaceCanvas.getContext('2d');
  const keypointFaceContext = keypointFaceCanvas.getContext('2d');

  function configureKeypointCanvas() {
    const width = referenceVideoEl.videoWidth || 1920;
    const height = referenceVideoEl.videoHeight || 1080;
    keypointCanvas.width = width;
    keypointCanvas.height = height;
  }

  function drawConnections(points, connections, color, lineWidth = 5) {
    keypointContext.strokeStyle = color;
    keypointContext.lineWidth = lineWidth;
    keypointContext.lineCap = 'round';
    keypointContext.lineJoin = 'round';

    connections.forEach(([from, to]) => {
      const a = points[from];
      const b = points[to];

      if (!a || !b || a.confidence <= 0 || b.confidence <= 0) {
        return;
      }

      keypointContext.beginPath();
      keypointContext.moveTo(a.x, a.y);
      keypointContext.lineTo(b.x, b.y);
      keypointContext.stroke();
    });
  }

  function drawPoints(points, color, radius = 5) {
    keypointContext.fillStyle = color;

    points.forEach((point) => {
      if (!point || point.confidence <= 0) {
        return;
      }

      keypointContext.beginPath();
      keypointContext.arc(point.x, point.y, radius, 0, Math.PI * 2);
      keypointContext.fill();
    });
  }

  function renderFaceZoomFromFacePoints(facePoints, sourceCanvas, zoomCanvas, zoomContext) {
    configureFaceCanvas(zoomCanvas);
    fillPreviewBackground(zoomContext, zoomCanvas);

    const bounds = getFaceBounds(facePoints, sourceCanvas.width, sourceCanvas.height);

    if (!bounds) {
      return;
    }

    zoomContext.drawImage(
      sourceCanvas,
      bounds.x,
      bounds.y,
      bounds.size,
      bounds.size,
      0,
      0,
      zoomCanvas.width,
      zoomCanvas.height,
    );
  }

  function drawCorrections(corrections) {
    corrections.forEach((item) => {
      const toX = Number(item.to[0]);
      const toY = Number(item.to[1]);
      if (!Number.isFinite(toX) || !Number.isFinite(toY)) {
        return;
      }
      const color = correctionPartColor(item.part);

      if (Array.isArray(item.from) && item.from.length >= 2) {
        const fromX = Number(item.from[0]);
        const fromY = Number(item.from[1]);
        if (Number.isFinite(fromX) && Number.isFinite(fromY)) {
          keypointContext.save();
          keypointContext.strokeStyle = 'rgba(248, 250, 252, 0.85)';
          keypointContext.lineWidth = 2;
          keypointContext.setLineDash([6, 5]);
          keypointContext.beginPath();
          keypointContext.moveTo(fromX, fromY);
          keypointContext.lineTo(toX, toY);
          keypointContext.stroke();
          keypointContext.restore();
        }
      }

      keypointContext.save();
      keypointContext.strokeStyle = color;
      keypointContext.lineWidth = 5;
      keypointContext.beginPath();
      keypointContext.arc(toX, toY, 11, 0, Math.PI * 2);
      keypointContext.stroke();
      keypointContext.fillStyle = '#020617';
      keypointContext.font = 'bold 22px "Segoe UI", sans-serif';
      keypointContext.fillText(String(item.joint), toX + 12, toY - 10);
      keypointContext.restore();
    });
  }

  function summarizeCorrections(corrections) {
    const byPart = new Map();
    let maxDelta = 0;
    corrections.forEach((item) => {
      byPart.set(item.part, (byPart.get(item.part) || 0) + 1);
      maxDelta = Math.max(maxDelta, Number(item.delta_px) || 0);
    });
    return {
      count: corrections.length,
      byPart: Object.fromEntries(byPart.entries()),
      maxDelta,
    };
  }

  function renderKeypointPreview(frameData) {
    configureKeypointCanvas();
    configureFaceCanvas(keypointFaceCanvas);
    fillPreviewBackground(keypointContext, keypointCanvas);

    const pose2d = parse2DKeypoints(frameData.people.pose_keypoints_2d);
    const leftHand2d = parse2DKeypoints(frameData.people.hand_left_keypoints_2d);
    const rightHand2d = parse2DKeypoints(frameData.people.hand_right_keypoints_2d);
    const face2d = parse2DKeypoints(frameData.people.face_keypoints_2d);

    drawConnections(pose2d, POSE_CONNECTIONS, '#38bdf8', 6);
    drawConnections(leftHand2d, HAND_CONNECTIONS, '#f97316', 4);
    drawConnections(rightHand2d, HAND_CONNECTIONS, '#22c55e', 4);
    drawPoints(face2d, 'rgba(226, 232, 240, 0.65)', 2);
    drawPoints(pose2d, '#e2e8f0', 5);
    drawPoints(leftHand2d, '#fdba74', 4);
    drawPoints(rightHand2d, '#86efac', 4);
    const corrections = correctionsForFrame(frameData);
    drawCorrections(corrections);
    renderFaceZoomFromFacePoints(face2d, keypointCanvas, keypointFaceCanvas, keypointFaceContext);
    return summarizeCorrections(corrections);
  }

  function renderReferenceFaceZoom(currentFrameData) {
    configureFaceCanvas(referenceFaceCanvas);
    fillPreviewBackground(referenceFaceContext, referenceFaceCanvas);

    if (!currentFrameData || referenceVideoEl.readyState < 2) {
      return;
    }

    const facePoints = parse2DKeypoints(currentFrameData.people.face_keypoints_2d);
    const bounds = getFaceBounds(facePoints, referenceVideoEl.videoWidth, referenceVideoEl.videoHeight);

    if (!bounds) {
      return;
    }

    referenceFaceContext.drawImage(
      referenceVideoEl,
      bounds.x,
      bounds.y,
      bounds.size,
      bounds.size,
      0,
      0,
      referenceFaceCanvas.width,
      referenceFaceCanvas.height,
    );
  }

  return {
    configureKeypointCanvas,
    renderKeypointPreview,
    renderReferenceFaceZoom,
  };
}
