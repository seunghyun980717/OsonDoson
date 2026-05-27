import {
  appendArrays,
  arraysToFrames,
  frameCountForArrays,
} from './keypoint-arrays.js';
import { payloadToClipAsset } from './clip-adapter.js';
import { generateTransition } from './transition-generator.js';
import { smoothSequence } from './sequence-smoother.js';

function addSegment(segments, segment) {
  segments.push({
    stroke_range: null,
    ...segment,
    end_frame: segment.start_frame + segment.frame_count - 1,
  });
}

function transitionDiagnosticFromClip(clip) {
  const diagnostics = clip.meta?.transition_diagnostics || {};
  const attempts = diagnostics.attempts || [];
  const finalAttempt = attempts[attempts.length - 1] || {};

  return {
    label: clip.label,
    strategy: diagnostics.final_strategy || finalAttempt.strategy || 'unknown',
    retry_count: Number(diagnostics.retry_count) || 0,
    fallback_count: Number(diagnostics.fallback_count) || 0,
    quality_failures: Number(diagnostics.quality_failures) || 0,
    passed: Boolean(diagnostics.passed ?? true),
    quality: finalAttempt.quality || null,
    attempts,
  };
}

function sourceForClip(clip) {
  return clip.meta?.source?.source_path
    || clip.meta?.source?.video_id
    || clip.path
    || clip.label;
}

export function composeSentenceFromClips(payloads, options = {}) {
  if (!payloads.length) {
    return {
      schema_version: 'sign-sentence-keypoints/v1',
      fps: Number(options.targetFps) || 30,
      glosses: [],
      segments: [],
      frames: [],
      stats: {
        source_clip_count: 0,
        generated_transition_count: 0,
        output_frame_count: 0,
        boundary_hold_frame_count: 0,
        cache_hits: 0,
        transition_retry_count: 0,
        transition_fallback_count: 0,
        transition_quality_failures: 0,
        transition_diagnostics: [],
      },
    };
  }

  const targetFps = Number(options.targetFps) || Number(payloads[0]?.fps) || 30;
  const transitionFrames = Math.max(0, Math.floor(Number(options.transitionFrames) || 0));
  const transitionMethod = options.transitionMethod || 'smoothstep';
  const allowTransitionFallback = options.allowTransitionFallback ?? true;
  const clips = payloads.map((payload) => payloadToClipAsset(payload, { targetFps }));
  let outputArrays = {};
  const segments = [];
  const transitionDiagnostics = [];
  let generatedTransitionCount = 0;
  let transitionRetryCount = 0;
  let transitionFallbackCount = 0;
  let transitionQualityFailures = 0;
  let cursor = 0;

  clips.forEach((clip, clipIndex) => {
    if (clipIndex > 0 && transitionFrames > 0) {
      const previousClip = clips[clipIndex - 1];
      const transitionClip = generateTransition(previousClip, clip, {
        method: transitionMethod,
        transitionFrames,
        allowFallback: allowTransitionFallback,
      });
      const frameCount = frameCountForArrays(transitionClip.arrays);
      const diagnostic = transitionDiagnosticFromClip(transitionClip);
      generatedTransitionCount += 1;
      transitionRetryCount += diagnostic.retry_count;
      transitionFallbackCount += diagnostic.fallback_count;
      transitionQualityFailures += diagnostic.quality_failures;
      transitionDiagnostics.push(diagnostic);

      outputArrays = appendArrays(outputArrays, transitionClip.arrays);
      addSegment(segments, {
        kind: 'generated-transition',
        label: transitionClip.label,
        gloss: transitionClip.label,
        start_frame: cursor,
        frame_count: frameCount,
        is_transition: true,
        source: 'generated-transition:sign-interpolator-js',
        diagnostics: diagnostic,
      });
      cursor += frameCount;
    }

    const sourceFrameCount = frameCountForArrays(clip.arrays);
    outputArrays = appendArrays(outputArrays, clip.arrays);
    addSegment(segments, {
      kind: 'source',
      label: clip.label,
      gloss: clip.label,
      start_frame: cursor,
      frame_count: sourceFrameCount,
      is_transition: false,
      source: sourceForClip(clip),
      source_clip: clip.meta?.source ?? null,
      source_segment: clip.meta?.segment ?? null,
    });
    cursor += sourceFrameCount;
  });

  const smoothedArrays = smoothSequence(outputArrays, segments);
  const frames = arraysToFrames(smoothedArrays);

  return {
    schema_version: 'sign-sentence-keypoints/v1',
    fps: targetFps,
    glosses: clips.map((clip) => clip.label),
    segments,
    frames,
    stats: {
      source_clip_count: clips.length,
      generated_transition_count: generatedTransitionCount,
      output_frame_count: frames.length,
      boundary_hold_frame_count: 0,
      cache_hits: 0,
      transition_retry_count: transitionRetryCount,
      transition_fallback_count: transitionFallbackCount,
      transition_quality_failures: transitionQualityFailures,
      transition_diagnostics: transitionDiagnostics,
    },
  };
}
