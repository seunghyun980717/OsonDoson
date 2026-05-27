import * as THREE from 'three';

export function getKeypoint3D(flatArray, index) {
  const base = index * 4;

  return new THREE.Vector3(
    flatArray[base],
    flatArray[base + 1],
    flatArray[base + 2],
  );
}

export function getKeypoint3DConfidence(flatArray, index) {
  return Number(flatArray?.[index * 4 + 3]) || 0;
}

export function getKeypoint2D(flatArray, index) {
  const base = index * 3;

  return {
    x: flatArray[base],
    y: flatArray[base + 1],
    confidence: flatArray[base + 2],
  };
}

export function distance2D(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function remapClamped(value, min, max) {
  if (max <= min) {
    return 0;
  }

  return THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
}

export function datasetToWorld(vector) {
  return new THREE.Vector3(vector.x, -vector.y, -vector.z);
}

export function pointDirection(from, to) {
  return datasetToWorld(to.clone().sub(from)).normalize();
}

export function blendDirections(primary, secondary, secondaryWeight = 0.5) {
  return primary
    .clone()
    .multiplyScalar(Math.max(0, 1 - secondaryWeight))
    .add(secondary.clone().multiplyScalar(secondaryWeight))
    .normalize();
}

export function createBasis(forward, sideHint) {
  const zAxis = forward.clone().normalize();
  const xAxis = sideHint.clone().normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  xAxis.crossVectors(yAxis, zAxis).normalize();

  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
}
