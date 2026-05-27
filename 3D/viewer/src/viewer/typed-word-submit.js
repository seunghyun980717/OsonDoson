export function createTypedWordSubmitGuard(options = {}) {
  const duplicateWindowMs = options.duplicateWindowMs ?? 250;
  const now = options.now ?? (() => performance.now());
  let lastGloss = null;
  let lastSubmittedAt = Number.NEGATIVE_INFINITY;

  return function shouldAcceptTypedWordSubmit(gloss, event = null) {
    if (!gloss || event?.isComposing || event?.repeat) {
      return false;
    }

    const submittedAt = now();
    const duplicateSubmit =
      lastGloss === gloss
      && submittedAt - lastSubmittedAt < duplicateWindowMs;

    lastGloss = gloss;
    lastSubmittedAt = submittedAt;

    return !duplicateSubmit;
  };
}
