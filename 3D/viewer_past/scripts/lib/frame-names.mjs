const keypointsFramePattern = /_(\d{12})_keypoints\.json$/;

export function frameNumberFromName(fileName, fallback = 0) {
  return Number(fileName.match(keypointsFramePattern)?.[1] ?? fallback);
}

export function replaceFrameSequenceKey(fileName, fromKey, toKey) {
  return fileName.replace(fromKey, toKey);
}
