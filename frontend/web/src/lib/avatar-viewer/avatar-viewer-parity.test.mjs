import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname);
const viewerRoot = path.resolve(webRoot, '../../../../../3D/viewer/src');

const parityFiles = [
  ['lib/head-face-strategies.js', 'lib/head-face-strategies.js'],
  ['viewer/rig-controller.js', 'viewer/rig-controller.js'],
  ['viewer/body-motion.js', 'viewer/body-motion.js'],
  ['viewer/face-morph-safety.js', 'viewer/face-morph-safety.js'],
  ['interpolator/sequence-composer.js', 'interpolator/sequence-composer.js'],
];

test('web avatar-viewer helpers stay aligned with latest 3D viewer helpers', async () => {
  await Promise.all(parityFiles.map(async ([viewerRelativePath, webRelativePath]) => {
    const [viewerSource, webSource] = await Promise.all([
      readFile(path.join(viewerRoot, viewerRelativePath), 'utf8'),
      readFile(path.join(webRoot, webRelativePath), 'utf8'),
    ]);

    assert.equal(webSource, viewerSource, webRelativePath);
  }));
});
