import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampFaceMorphs,
  stabilizeEyeMorphs,
} from './face-morph-safety.js';

test('face morph safety disables eye-wide morphs', () => {
  assert.deepEqual(
    clampFaceMorphs({
      eyeWideLeft: 0.9,
      eyeWideRight: 0.7,
      eyeBlinkLeft: 0.8,
    }),
    {
      eyeWideLeft: 0,
      eyeWideRight: 0,
      eyeBlinkLeft: 0.8,
    },
  );
});

test('face morph safety clamps invalid morph values to the valid range', () => {
  assert.deepEqual(
    clampFaceMorphs({
      mouthOpen: 1.5,
      mouthPucker: -0.25,
    }),
    {
      mouthOpen: 1,
      mouthPucker: 0,
    },
  );
});

test('eye morph stabilization keeps closure responsive and release smooth', () => {
  assert.deepEqual(
    stabilizeEyeMorphs(
      {
        eyeBlinkLeft: 1,
        eyeBlinkRight: 0,
        eyeSquintLeft: 1,
        mouthOpen: 0.2,
      },
      {
        eyeBlinkLeft: 0,
        eyeBlinkRight: 1,
        eyeSquintLeft: 0,
      },
      {
        blinkCloseBlend: 0.8,
        blinkReleaseBlend: 0.4,
        squintBlend: 0.5,
      },
    ),
    {
      eyeBlinkLeft: 0.8,
      eyeBlinkRight: 0.6,
      eyeSquintLeft: 0.5,
      mouthOpen: 0.2,
    },
  );
});
