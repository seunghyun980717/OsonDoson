export const FACE_MORPH_LIMITS = Object.freeze({
  browInnerUp: 0.08,
  browOuterUpLeft: 0.08,
  browOuterUpRight: 0.08,
  browDownLeft: 0.12,
  browDownRight: 0.12,
  eyeWideLeft: 0,
  eyeWideRight: 0,
});

export const SENTENCE_EYE_CONTAINMENT = Object.freeze({
  minBlink: 0.14,
  minSquint: 0.02,
  maxWide: 0,
});

function clamp01(value) {
  const number = Number(value) || 0;
  return Math.min(Math.max(number, 0), 1);
}

export function clampFaceMorphs(morphs, limits = FACE_MORPH_LIMITS) {
  if (!morphs) {
    return morphs;
  }

  const clampedMorphs = { ...morphs };

  Object.entries(clampedMorphs).forEach(([name, value]) => {
    clampedMorphs[name] = clamp01(value);
  });

  Object.entries(limits).forEach(([name, limit]) => {
    if (clampedMorphs[name] !== undefined) {
      clampedMorphs[name] = Math.min(clampedMorphs[name], limit);
    }
  });

  return clampedMorphs;
}

function blendMorphValue(currentValue, targetValue, blend) {
  const amount = clamp01(blend);
  return currentValue + ((targetValue - currentValue) * amount);
}

export function stabilizeEyeMorphs(morphs, previousMorphs = {}, options = {}) {
  if (!morphs) {
    return morphs;
  }

  const blinkCloseBlend = Number.isFinite(options.blinkCloseBlend)
    ? options.blinkCloseBlend
    : 0.85;
  const blinkReleaseBlend = Number.isFinite(options.blinkReleaseBlend)
    ? options.blinkReleaseBlend
    : 0.42;
  const squintBlend = Number.isFinite(options.squintBlend)
    ? options.squintBlend
    : 0.55;
  const stabilizedMorphs = { ...morphs };

  ['eyeBlinkLeft', 'eyeBlinkRight'].forEach((name) => {
    if (stabilizedMorphs[name] === undefined) {
      return;
    }

    const currentValue = clamp01(previousMorphs?.[name]);
    const targetValue = clamp01(stabilizedMorphs[name]);
    const blend = targetValue > currentValue ? blinkCloseBlend : blinkReleaseBlend;
    stabilizedMorphs[name] = blendMorphValue(currentValue, targetValue, blend);
  });

  ['eyeSquintLeft', 'eyeSquintRight'].forEach((name) => {
    if (stabilizedMorphs[name] === undefined) {
      return;
    }

    stabilizedMorphs[name] = blendMorphValue(
      clamp01(previousMorphs?.[name]),
      clamp01(stabilizedMorphs[name]),
      squintBlend,
    );
  });

  return stabilizedMorphs;
}

export function containSentenceEyeMorphs(morphs, options = SENTENCE_EYE_CONTAINMENT) {
  if (!morphs) {
    return morphs;
  }

  const containedMorphs = { ...morphs };
  const minBlink = clamp01(options.minBlink ?? SENTENCE_EYE_CONTAINMENT.minBlink);
  const minSquint = clamp01(options.minSquint ?? SENTENCE_EYE_CONTAINMENT.minSquint);
  const maxWide = clamp01(options.maxWide ?? SENTENCE_EYE_CONTAINMENT.maxWide);

  containedMorphs.eyeBlinkLeft = Math.max(containedMorphs.eyeBlinkLeft ?? 0, minBlink);
  containedMorphs.eyeBlinkRight = Math.max(containedMorphs.eyeBlinkRight ?? 0, minBlink);
  containedMorphs.eyeSquintLeft = Math.max(containedMorphs.eyeSquintLeft ?? 0, minSquint);
  containedMorphs.eyeSquintRight = Math.max(containedMorphs.eyeSquintRight ?? 0, minSquint);
  containedMorphs.eyeWideLeft = Math.min(containedMorphs.eyeWideLeft ?? 0, maxWide);
  containedMorphs.eyeWideRight = Math.min(containedMorphs.eyeWideRight ?? 0, maxWide);

  return containedMorphs;
}
