import * as THREE from 'three';

type Point2D = {
  confidence: number;
  x: number;
  y: number;
};

export const getKeypoint3D = (flatArray: readonly number[], index: number) => {
  const base = index * 4;

  return new THREE.Vector3(
    flatArray[base] ?? 0,
    flatArray[base + 1] ?? 0,
    flatArray[base + 2] ?? 0,
  );
};

export const getKeypoint3DConfidence = (flatArray: readonly number[], index: number) => (
  Number(flatArray[index * 4 + 3]) || 0
);

export const getKeypoint2D = (flatArray: readonly number[], index: number): Point2D => {
  const base = index * 3;

  return {
    confidence: flatArray[base + 2] ?? 0,
    x: flatArray[base] ?? 0,
    y: flatArray[base + 1] ?? 0,
  };
};

export const distance2D = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

export const remapClamped = (value: number, min: number, max: number) => {
  if (max <= min) {
    return 0;
  }

  return THREE.MathUtils.clamp((value - min) / (max - min), 0, 1);
};

export const datasetToWorld = (vector: THREE.Vector3) => (
  new THREE.Vector3(vector.x, -vector.y, -vector.z)
);

export const pointDirection = (from: THREE.Vector3, to: THREE.Vector3) => (
  datasetToWorld(to.clone().sub(from)).normalize()
);

export const blendDirections = (
  primary: THREE.Vector3,
  secondary: THREE.Vector3,
  secondaryWeight = 0.5,
) => (
  primary
    .clone()
    .multiplyScalar(Math.max(0, 1 - secondaryWeight))
    .add(secondary.clone().multiplyScalar(secondaryWeight))
    .normalize()
);

export const createBasis = (forward: THREE.Vector3, sideHint: THREE.Vector3) => {
  const zAxis = forward.clone().normalize();
  const xAxis = sideHint.clone().normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

  xAxis.crossVectors(yAxis, zAxis).normalize();

  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(basis);
};
