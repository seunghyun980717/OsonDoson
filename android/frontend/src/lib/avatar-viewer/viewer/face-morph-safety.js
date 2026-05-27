export const FACE_MORPH_LIMITS = Object.freeze({
  browInnerUp: 0.08,
  browOuterUpLeft: 0.08,
  browOuterUpRight: 0.08,
  browDownLeft: 0.12,
  browDownRight: 0.12,
  eyeWideLeft: 0,
  eyeWideRight: 0,
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
