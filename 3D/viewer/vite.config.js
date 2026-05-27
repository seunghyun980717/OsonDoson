import fs from 'node:fs';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const viewerDataRoot =
    env.VITE_VIEWER_DATA_ROOT ??
    env.THREE_D_VIEWER_DATA_ROOT ??
    resolve(__dirname, '../../..');
  const wordRoot =
    env.VITE_WORD_DATA_ROOT ??
    env.THREE_D_WORDS_ROOT ??
    resolve(viewerDataRoot, 'word_dic');
  const referenceVideoRoot =
    env.VITE_REFERENCE_VIDEO_ROOT ??
    env.THREE_D_REFERENCE_VIDEO_ROOT ??
    resolveFirstExistingChild(viewerDataRoot, [
      '[원천]01_real_word_video/word',
      '수어 영상/1.Training/[원천]01_real_word_video/word',
    ]);
  const wordDicRoot =
    env.VITE_WORD_DIC_DATA_ROOT ??
    resolve(__dirname, '../../../word_dic');
  const wordDicReferenceVideoRoot =
    env.VITE_WORD_DIC_REFERENCE_VIDEO_ROOT ??
    resolve(__dirname, '../../../수어 영상/1.Training/[원천]01_real_word_video/word');
  const dictionaryVersions = [
    {
      id: 'current',
      label: 'Current',
      wordRoot,
      wordsUrlPrefix: '/words',
      indexUrl: '/words-index.json',
      referenceVideoRoot,
      referenceVideoUrlPrefix: '/reference-videos',
    },
    {
      id: 'word-dic',
      label: 'word_dic',
      wordRoot: wordDicRoot,
      wordsUrlPrefix: '/dictionary-versions/word-dic/words',
      indexUrl: '/dictionary-versions/word-dic/words-index.json',
      referenceVideoRoot: wordDicReferenceVideoRoot,
      referenceVideoUrlPrefix: '/dictionary-versions/word-dic/reference-videos',
    },
  ];

  return {
    plugins: [
      dictionaryVersionsPlugin('/dictionary-versions.json', dictionaryVersions),
      ...dictionaryVersions.flatMap((version) => [
        externalStaticPlugin(version.wordsUrlPrefix, version.wordRoot),
        externalStaticPlugin(version.referenceVideoUrlPrefix, version.referenceVideoRoot),
        wordIndexPlugin(version.indexUrl, version),
      ]),
    ],
    server: {
      fs: {
        allow: [
          __dirname,
          viewerDataRoot,
          ...dictionaryVersions.flatMap((version) => [
            version.wordRoot,
            version.referenceVideoRoot,
          ]),
        ],
      },
    },
    build: {
      emptyOutDir: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
        },
      },
    },
  };
});

function dictionaryVersionsPlugin(urlPath, versions) {
  return {
    name: 'dictionary-versions',
    configureServer(server) {
      const payload = {
        versions: versions.map((version) => ({
          id: version.id,
          label: version.label,
          indexUrl: version.indexUrl,
          referenceVideoUrlPrefix: version.referenceVideoUrlPrefix,
          isDefault: version.id === 'current',
        })),
      };

      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url?.split('?')[0] ?? '';

        if (requestUrl !== urlPath) {
          next();
          return;
        }

        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(payload));
      });
    },
  };
}

function resolveFirstExistingChild(rootDir, relativePaths) {
  for (const relativePath of relativePaths) {
    const candidates = [
      resolve(rootDir, relativePath),
      resolve(rootDir, relativePath.normalize('NFD')),
    ];
    const existingPath = candidates.find((candidate) => fs.existsSync(candidate));

    if (existingPath) {
      return existingPath;
    }
  }

  return resolve(rootDir, relativePaths[0]);
}

function externalStaticPlugin(urlPrefix, rootDir) {
  return {
    name: `external-static:${urlPrefix}`,
    configureServer(server) {
      const absoluteRoot = path.resolve(rootDir);

      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url?.split('?')[0] ?? '';

        if (!requestUrl.startsWith(`${urlPrefix}/`) && requestUrl !== urlPrefix) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(requestUrl.slice(urlPrefix.length));
        const filePath = path.resolve(absoluteRoot, `.${relativePath}`);
        const relativeToRoot = path.relative(absoluteRoot, filePath);

        if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        fs.stat(filePath, (statError, stats) => {
          if (statError || !stats.isFile()) {
            next();
            return;
          }

          res.setHeader('Accept-Ranges', 'bytes');
          res.setHeader('Content-Type', contentTypeFor(filePath));

          const range = req.headers.range;
          if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);

            if (!match) {
              res.statusCode = 416;
              res.setHeader('Content-Range', `bytes */${stats.size}`);
              res.end();
              return;
            }

            const start = match[1] ? Number(match[1]) : 0;
            const end = match[2] ? Number(match[2]) : stats.size - 1;
            const boundedEnd = Math.min(end, stats.size - 1);

            if (!Number.isFinite(start) || start > boundedEnd || start >= stats.size) {
              res.statusCode = 416;
              res.setHeader('Content-Range', `bytes */${stats.size}`);
              res.end();
              return;
            }

            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${boundedEnd}/${stats.size}`);
            res.setHeader('Content-Length', String(boundedEnd - start + 1));
            fs.createReadStream(filePath, { start, end: boundedEnd }).pipe(res);
            return;
          }

          res.setHeader('Content-Length', String(stats.size));
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
  };
}

function wordIndexPlugin(urlPath, version) {
  return {
    name: `word-dictionary-index:${version.id}`,
    configureServer(server) {
      const absoluteRoot = path.resolve(version.wordRoot);
      let cache = null;

      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url?.split('?')[0] ?? '';

        if (requestUrl !== urlPath) {
          next();
          return;
        }

        try {
          cache ??= buildWordIndex(absoluteRoot, version);
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(cache));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            words: [],
            invalidCount: 0,
            invalidFiles: [],
            error: error.message,
          }));
        }
      });
    },
  };
}

function buildWordIndex(rootDir, version) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const words = [];
  const invalidFiles = [];

  entries
    .filter((entry) => (
      entry.isFile()
      && entry.name.toLowerCase().endsWith('.json')
      && !entry.name.startsWith('_')
    ))
    .forEach((entry) => {
      const filePath = path.join(rootDir, entry.name);

      try {
        const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        validateWordClip(payload);
        const gloss = String(payload.gloss || entry.name.slice(0, -'.json'.length));
        words.push({
          gloss,
          file: entry.name,
          path: `${version.wordsUrlPrefix}/${encodeURIComponent(entry.name)}`,
          referenceVideoRef: `${entry.name.slice(0, -'.json'.length)}.mp4`,
          referenceVideoBase: version.referenceVideoUrlPrefix,
          dictionaryVersionId: version.id,
          fps: Number(payload.fps) || 30,
          frameCount: payload.frames.length,
          dataset: payload.source?.dataset ?? null,
          videoId: payload.source?.video_id ?? null,
        });
      } catch (error) {
        invalidFiles.push({
          file: entry.name,
          error: error.message,
        });
      }
    });

  words.sort((a, b) => a.gloss.localeCompare(b.gloss, 'ko', {
    numeric: true,
    sensitivity: 'base',
  }));

  return {
    schema_version: 'word-dictionary-index/v1',
    root: rootDir,
    totalFiles: words.length + invalidFiles.length,
    validCount: words.length,
    invalidCount: invalidFiles.length,
    invalidFiles: invalidFiles.slice(0, 100),
    words,
  };
}

function validateWordClip(payload) {
  if (payload?.schema_version !== 'sign-keypoint-clip/v1') {
    throw new Error('Expected schema_version sign-keypoint-clip/v1.');
  }

  if (!Array.isArray(payload.frames) || payload.frames.length === 0) {
    throw new Error('Missing non-empty frames array.');
  }

  const people = payload.frames[0]?.people;
  [
    'pose_keypoints_3d',
    'hand_left_keypoints_3d',
    'hand_right_keypoints_3d',
  ].forEach((key) => {
    if (!Array.isArray(people?.[key])) {
      throw new Error(`Missing ${key}.`);
    }
  });
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.json') {
    return 'application/json; charset=utf-8';
  }

  if (extension === '.glb') {
    return 'model/gltf-binary';
  }

  if (extension === '.mp4') {
    return 'video/mp4';
  }

  return 'application/octet-stream';
}
