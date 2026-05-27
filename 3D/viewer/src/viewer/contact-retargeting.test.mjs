import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  applyTorsoCollisionCorrection,
  computeSharedTorsoMotion,
  computeCanonicalWristTarget,
  detectFaceHandProximity,
  detectTwoHandContact,
  solveTwoBoneArmIkDirections,
} from './body-motion.js';

function flatKeypoints(count) {
  return Array.from({ length: count * 4 }, () => 0);
}

function setPoint(flat, index, x, y, z, confidence = 1) {
  const base = index * 4;
  flat[base] = x;
  flat[base + 1] = y;
  flat[base + 2] = z;
  flat[base + 3] = confidence;
}

function poseWithShoulders() {
  const pose = flatKeypoints(18);
  setPoint(pose, 2, -0.5, 0, 0);
  setPoint(pose, 5, 0.5, 0, 0);
  return pose;
}

function torsoBasis() {
  return {
    forward: new THREE.Vector3(0, 0, 1),
    horizontalForward: new THREE.Vector3(0, 0, 1),
    side: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0),
  };
}

test('canonical wrist blends pose wrist and reliable hand root', () => {
  const hand = flatKeypoints(21);
  setPoint(hand, 0, 1, 0, 0);

  const wrist = computeCanonicalWristTarget(new THREE.Vector3(0, 0, 0), hand);

  assert.equal(wrist.x, 0.65);
  assert.equal(wrist.y, 0);
  assert.equal(wrist.z, 0);
});

test('canonical wrist falls back to pose wrist when hand root confidence is low', () => {
  const hand = flatKeypoints(21);
  setPoint(hand, 0, 1, 0, 0, 0);

  const wrist = computeCanonicalWristTarget(new THREE.Vector3(0.2, 0.3, 0.4), hand);

  assert.deepEqual(wrist.toArray(), [0.2, 0.3, 0.4]);
});

test('two-hand contact detects finger contact instead of relying on wrist distance', () => {
  const left = flatKeypoints(21);
  const right = flatKeypoints(21);
  setPoint(left, 10, 0, 0, 0);
  setPoint(right, 18, 0.02, 0, 0);
  setPoint(left, 0, -0.3, 0, 0);
  setPoint(right, 0, 0.3, 0, 0);

  const contact = detectTwoHandContact(left, right, poseWithShoulders(), {
    enterDistance: 0.08,
    exitDistance: 0.14,
  });

  assert.equal(contact.active, true);
  assert.ok(contact.strength > 0.5);
});

test('face-hand proximity detects a hand in front of the face zone', () => {
  const pose = poseWithShoulders();
  const face = flatKeypoints(68);
  const hand = flatKeypoints(21);

  [27, 28, 29, 30, 31, 33, 36, 39, 42, 45, 48, 54]
    .forEach((index) => setPoint(face, index, 0, -0.58, -0.22));
  [0, 5, 9, 13, 17]
    .forEach((index) => setPoint(hand, index, 0.05, -0.62, -0.75));

  const proximity = detectFaceHandProximity(hand, face, pose, {
    torsoBasis: torsoBasis(),
  });

  assert.equal(proximity.active, true);
  assert.ok(proximity.strength > 0.5);
});

test('face-hand proximity ignores a hand far below the face zone', () => {
  const pose = poseWithShoulders();
  const face = flatKeypoints(68);
  const hand = flatKeypoints(21);

  [27, 28, 29, 30, 31, 33, 36, 39, 42, 45, 48, 54]
    .forEach((index) => setPoint(face, index, 0, -0.58, -0.22));
  [0, 5, 9, 13, 17]
    .forEach((index) => setPoint(hand, index, 0.05, 1.45, -0.75));

  const proximity = detectFaceHandProximity(hand, face, pose, {
    torsoBasis: torsoBasis(),
  });

  assert.equal(proximity.active, false);
});

test('torso collision uses palm depth even when wrist depth is safe', () => {
  const pose = poseWithShoulders();
  const hand = flatKeypoints(21);
  [0, 5, 9, 13, 17].forEach((index) => setPoint(hand, index, 0, 0, 0.2));

  const corrected = applyTorsoCollisionCorrection(
    pose,
    {
      elbow: new THREE.Vector3(0, 0, -0.2),
      wrist: new THREE.Vector3(0, 0, 0),
    },
    {
      elbowRatio: 0.35,
      handPoints: hand,
      maxPush: 0.24,
      smoothing: 1,
      state: { active: false, pushWorld: new THREE.Vector3() },
      targetForward: 0.16,
      torsoBasis: torsoBasis(),
    },
  );

  assert.ok(corrected.wrist.z < -0.2);
  assert.ok(corrected.elbow.z < -0.25);
});

test('torso collision does not push a hand outside chest side bounds', () => {
  const pose = poseWithShoulders();
  const hand = flatKeypoints(21);
  [0, 5, 9, 13, 17].forEach((index) => setPoint(hand, index, 2, 0, 0.2));

  const corrected = applyTorsoCollisionCorrection(
    pose,
    {
      elbow: new THREE.Vector3(2, 0, -0.2),
      wrist: new THREE.Vector3(2, 0, 0),
    },
    {
      handPoints: hand,
      smoothing: 1,
      state: { active: false, pushWorld: new THREE.Vector3() },
      torsoBasis: torsoBasis(),
    },
  );

  assert.deepEqual(corrected.wrist.toArray(), [2, 0, 0]);
});

test('torso side tilt scale damps lateral sway while keeping forward tilt', () => {
  const pose = flatKeypoints(18);
  setPoint(pose, 1, 0, -1, 0);
  setPoint(pose, 2, -0.5, 0, 0);
  setPoint(pose, 5, 0.5, 0, 0);
  setPoint(pose, 8, 0, 0, 0);
  const tiltedBasis = {
    forward: new THREE.Vector3(0, 0, 1),
    horizontalForward: new THREE.Vector3(0, 0, 1),
    side: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0.16, 0.98, 0.08).normalize(),
  };

  const full = computeSharedTorsoMotion(pose, {
    buildTorsoBasisFromPose3D: () => tiltedBasis,
    forwardTiltScale: 0.65,
    sideTiltScale: 1.05,
  });
  const damped = computeSharedTorsoMotion(pose, {
    buildTorsoBasisFromPose3D: () => tiltedBasis,
    forwardTiltScale: 0.65,
    sideTiltScale: 0.45,
  });

  assert.ok(Math.abs(damped.controlledHorizontalTilt.x) < Math.abs(full.controlledHorizontalTilt.x) * 0.5);
  assert.equal(damped.controlledHorizontalTilt.z, full.controlledHorizontalTilt.z);
});

test('two-bone IK produces directions that reach the target with avatar limb lengths', () => {
  const result = solveTwoBoneArmIkDirections(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.4, -0.2, 0),
    new THREE.Vector3(0.8, 0, 0),
    {
      forearmLength: 0.5,
      upperLength: 0.5,
    },
  );

  assert.ok(result);

  const elbow = result.upperDirection.clone().multiplyScalar(0.5);
  const wrist = elbow.clone().add(result.forearmDirection.clone().multiplyScalar(0.5));

  assert.ok(wrist.distanceTo(new THREE.Vector3(0.8, 0, 0)) < 1e-6);
});
