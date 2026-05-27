import path from 'node:path';

function getPublicDataRoot(projectRootOrOptions) {
  if (typeof projectRootOrOptions === 'object' && projectRootOrOptions?.publicDataRoot) {
    return projectRootOrOptions.publicDataRoot;
  }

  return path.join(projectRootOrOptions, 'public', 'data');
}

export function publicSequenceFrameDir(projectRootOrOptions, sequence) {
  return path.join(getPublicDataRoot(projectRootOrOptions), sequence.frameDir.replace(/^\/data\//, ''));
}

export function publicSequenceFramePath(projectRootOrOptions, sequence, fileName) {
  return path.join(publicSequenceFrameDir(projectRootOrOptions, sequence), fileName);
}

export function sourceViewKey(sourceKey, view) {
  return sourceKey.replace(/_F$/, `_${view}`);
}
