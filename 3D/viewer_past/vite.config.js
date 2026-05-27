import fs from 'node:fs';
import path, { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const dataRoot = env.VITE_VIEWER_DATA_ROOT ?? env.THREE_D_PUBLIC_DATA_ROOT;
  const videoRoot = env.VITE_VIEWER_VIDEO_ROOT ?? env.THREE_D_PUBLIC_VIDEO_ROOT;
  const sentenceRoot =
    env.VITE_SENTENCE_DATA_ROOT ??
    env.THREE_D_SENTENCES_ROOT ??
    resolve(__dirname, '../sen');
  const aihubRoot =
    env.VITE_AIHUB_KEYPOINT_ROOT ??
    env.THREE_D_AIHUB_KEYPOINT_ROOT ??
    resolve(__dirname, '../../../수어 영상/1.Training');
  const wordRoot =
    env.VITE_WORD_DATA_ROOT ??
    env.THREE_D_WORDS_ROOT ??
    resolve(__dirname, '../data/words');

  return {
    plugins: [
      externalStaticPlugin('/data', dataRoot),
      externalStaticPlugin('/videos', videoRoot),
      externalStaticPlugin('/sen', sentenceRoot),
      externalStaticPlugin('/words', wordRoot),
      wordIndexPlugin('/words-index.json', wordRoot),
      interpolationTestPlugin({
        env,
        sentenceRoot,
        aihubRoot,
        wordRoot,
      }),
    ],
    server: {
      fs: {
        allow: [
          __dirname,
          ...(dataRoot ? [dataRoot] : []),
          ...(videoRoot ? [videoRoot] : []),
          ...(sentenceRoot ? [sentenceRoot] : []),
          ...(aihubRoot ? [aihubRoot] : []),
          ...(wordRoot ? [wordRoot] : []),
        ],
      },
    },
    build: {
      emptyOutDir: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'index.html'),
          compare: resolve(__dirname, 'compare.html'),
          tcnCompare: resolve(__dirname, 'tcn-compare.html'),
          keypointSmoothingCompare: resolve(__dirname, 'keypoint-smoothing-compare.html'),
          keypointPreprocessCompare: resolve(__dirname, 'keypoint-preprocess-compare.html'),
          sentence: resolve(__dirname, 'sentence.html'),
        },
      },
    },
  };
});

function interpolationTestPlugin({ env, sentenceRoot, aihubRoot, wordRoot }) {
  return {
    name: 'interpolation-test-runner',
    configureServer(server) {
      server.middlewares.use('/api/interpolation-tests/run', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        try {
          const payload = await readJsonBody(req);
          const testName = sanitizeTestName(payload.testName);
          const words = normalizeWords(payload.words);
          const inputSource = String(payload.inputSource || env.THREE_D_INTERPOLATION_INPUT_SOURCE || 'aihub');
          const transitionFrames = Math.max(1, Math.floor(Number(payload.transitionFrames) || 12));
          const pythonExecutable = env.THREE_D_PYTHON ?? env.PYTHON ?? 'python3';
          const outputRoot = path.join(path.resolve(sentenceRoot), 'interpolation-tests');
          const scriptPath = path.resolve(__dirname, '..', 'sign_interpolator', 'compare_interpolation_methods.py');
          const args = [
            scriptPath,
            '--test-name',
            testName,
            '--word-root',
            path.resolve(wordRoot),
            '--aihub-root',
            path.resolve(aihubRoot),
            '--input-source',
            inputSource,
            '--output-root',
            outputRoot,
            '--transition-frames',
            String(transitionFrames),
            '--words',
            ...words,
          ];
          const result = await runProcess(pythonExecutable, args, path.resolve(__dirname, '..'));
          const reportPath = path.join(outputRoot, testName, 'report.json');
          const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            ok: true,
            stdout: result.stdout,
            report,
          }));
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            error: error.message,
            stdout: error.stdout,
            stderr: error.stderr,
          }));
        }
      });
    },
  };
}

function readJsonBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeTestName(value) {
  const testName = String(value || 'default')
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, '-');
  if (!testName) {
    return 'default';
  }
  return testName;
}

function normalizeWords(value) {
  const words = Array.isArray(value)
    ? value.map((word) => String(word).trim()).filter(Boolean)
    : String(value || '').split(/[,\s]+/).map((word) => word.trim()).filter(Boolean);
  if (!words.length) {
    throw new Error('At least one word is required.');
  }
  return words;
}

function runProcess(command, args, cwd) {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolveProcess({ stdout, stderr });
        return;
      }
      const error = new Error(`Interpolation runner exited with code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function externalStaticPlugin(urlPrefix, rootDir) {
  return {
    name: `external-static:${urlPrefix}`,
    configureServer(server) {
      if (!rootDir) {
        return;
      }

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

          res.setHeader('Content-Type', contentTypeFor(filePath));
          fs.createReadStream(filePath).pipe(res);
        });
      });
    },
  };
}

function wordIndexPlugin(urlPath, rootDir) {
  return {
    name: 'word-index',
    configureServer(server) {
      if (!rootDir) {
        return;
      }

      const absoluteRoot = path.resolve(rootDir);

      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url?.split('?')[0] ?? '';

        if (requestUrl !== urlPath) {
          next();
          return;
        }

        fs.readdir(absoluteRoot, { withFileTypes: true }, (error, entries) => {
          if (error) {
            res.statusCode = 500;
            res.end(JSON.stringify({ words: [], error: error.message }));
            return;
          }

          const words = entries
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
            .map((entry) => {
              const word = entry.name.slice(0, -'.json'.length);
              const qaInfo = wordQaInfo(word);
              return {
                word,
                label: qaInfo.label,
                sourceWord: qaInfo.sourceWord,
                qaKind: qaInfo.kind,
                file: entry.name,
                path: `/words/${encodeURIComponent(word)}.json`,
              };
            })
            .sort((a, b) => {
              const sourceCompare = a.sourceWord.localeCompare(b.sourceWord, 'ko', {
                numeric: true,
                sensitivity: 'base',
              });
              if (sourceCompare !== 0) {
                return sourceCompare;
              }
              const kindRank = {
                source: 0,
                original2d_QA_full: 1,
                smooth2d_QA_full: 1,
                smooth2d_v2_QA_full: 2,
                repair2d_QA_full: 3,
                mlp_QA: 4,
                mlp_QA_full: 5,
                mlp_v0_5_QA: 6,
                mlp_v0_5_QA_full: 7,
                post_v0_5_QA_full: 8,
                post_v0_5_ik_QA_full: 9,
                post_v0_5_motion_ik_QA_full: 10,
                tcn_v1_center_QA_full: 11,
                tcn_v1_1_center_QA_full: 12,
                tcn_v1_sequence_QA_full: 13,
                tcn_v1_center_smooth2d_QA_full: 14,
                tcn_v1_sequence_smooth2d_QA_full: 15,
                post_v0_5_QA: 16,
                post_v0_5_ik_QA: 17,
                post_v0_5_motion_ik_QA: 18,
                tcn_v1_center_QA: 19,
                tcn_v1_sequence_QA: 20,
                qa: 21,
              };
              const rankCompare = (kindRank[a.qaKind] ?? 9) - (kindRank[b.qaKind] ?? 9);
              if (rankCompare !== 0) {
                return rankCompare;
              }
              return a.word.localeCompare(b.word, 'ko', {
                numeric: true,
                sensitivity: 'base',
              });
            });

          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ words }));
        });
      });
    },
  };
}

function wordQaInfo(word) {
  const tcnV11CenterMatch = /^tcn_v1_1_center_QA_full_(\d+)_(.+)$/.exec(word);
  if (tcnV11CenterMatch) {
    const sourceWord = tcnV11CenterMatch[2];
    return {
      kind: 'tcn_v1_1_center_QA_full',
      sourceWord,
      label: `tcn_v1.1_center_full ${sourceWord}`,
    };
  }

  const tcnV1CenterSmooth2dMatch = /^tcn_v1_center_smooth2d_QA_full_(\d+)_(.+)$/.exec(word);
  if (tcnV1CenterSmooth2dMatch) {
    const sourceWord = tcnV1CenterSmooth2dMatch[2];
    return {
      kind: 'tcn_v1_center_smooth2d_QA_full',
      sourceWord,
      label: `tcn_v1_center_smooth2d_full ${sourceWord}`,
    };
  }

  const tcnV1SequenceSmooth2dMatch = /^tcn_v1_sequence_smooth2d_QA_full_(\d+)_(.+)$/.exec(word);
  if (tcnV1SequenceSmooth2dMatch) {
    const sourceWord = tcnV1SequenceSmooth2dMatch[2];
    return {
      kind: 'tcn_v1_sequence_smooth2d_QA_full',
      sourceWord,
      label: `tcn_v1_sequence_smooth2d_full ${sourceWord}`,
    };
  }

  const original2dMatch = /^original2d_QA_full_(\d+)_(.+)$/.exec(word);
  if (original2dMatch) {
    const sourceWord = original2dMatch[2];
    return {
      kind: 'original2d_QA_full',
      sourceWord,
      label: `original2d_full ${sourceWord}`,
    };
  }

  const smooth2dMatch = /^smooth2d_QA_full_(\d+)_(.+)$/.exec(word);
  if (smooth2dMatch) {
    const sourceWord = smooth2dMatch[2];
    return {
      kind: 'smooth2d_QA_full',
      sourceWord,
      label: `smooth2d_full ${sourceWord}`,
    };
  }

  const smooth2dV2Match = /^smooth2d_v2_QA_full_(\d+)_(.+)$/.exec(word);
  if (smooth2dV2Match) {
    const sourceWord = smooth2dV2Match[2];
    return {
      kind: 'smooth2d_v2_QA_full',
      sourceWord,
      label: `smooth2d_v2_full ${sourceWord}`,
    };
  }

  const repair2dMatch = /^repair2d_QA_full_(\d+)_(.+)$/.exec(word);
  if (repair2dMatch) {
    const sourceWord = repair2dMatch[2];
    return {
      kind: 'repair2d_QA_full',
      sourceWord,
      label: `repair2d_full ${sourceWord}`,
    };
  }

  const tcnV1CenterMatch = /^tcn_v1_center_QA_(full_)?(\d+)_(.+)$/.exec(word);
  if (tcnV1CenterMatch) {
    const isFull = Boolean(tcnV1CenterMatch[1]);
    const sourceWord = tcnV1CenterMatch[3];
    return {
      kind: isFull ? 'tcn_v1_center_QA_full' : 'tcn_v1_center_QA',
      sourceWord,
      label: `${isFull ? 'tcn_v1_center_full' : 'tcn_v1_center'} ${sourceWord}`,
    };
  }

  const tcnV1SequenceMatch = /^tcn_v1_sequence_QA_(full_)?(\d+)_(.+)$/.exec(word);
  if (tcnV1SequenceMatch) {
    const isFull = Boolean(tcnV1SequenceMatch[1]);
    const sourceWord = tcnV1SequenceMatch[3];
    return {
      kind: isFull ? 'tcn_v1_sequence_QA_full' : 'tcn_v1_sequence_QA',
      sourceWord,
      label: `${isFull ? 'tcn_v1_sequence_full' : 'tcn_v1_sequence'} ${sourceWord}`,
    };
  }

  const postMotionIkV05Match = /^post_v0_5_motion_ik_QA_(full_)?(\d+)_(.+)$/.exec(word);
  if (postMotionIkV05Match) {
    const isFull = Boolean(postMotionIkV05Match[1]);
    const sourceWord = postMotionIkV05Match[3];
    return {
      kind: isFull ? 'post_v0_5_motion_ik_QA_full' : 'post_v0_5_motion_ik_QA',
      sourceWord,
      label: `${isFull ? 'post_0.5_motion_ik_full' : 'post_0.5_motion_ik'} ${sourceWord}`,
    };
  }

  const postIkV05Match = /^post_v0_5_ik_QA_(full_)?(\d+)_(.+)$/.exec(word);
  if (postIkV05Match) {
    const isFull = Boolean(postIkV05Match[1]);
    const sourceWord = postIkV05Match[3];
    return {
      kind: isFull ? 'post_v0_5_ik_QA_full' : 'post_v0_5_ik_QA',
      sourceWord,
      label: `${isFull ? 'post_0.5_ik_full' : 'post_0.5_ik'} ${sourceWord}`,
    };
  }

  const v05Match = /^mlp_v0_5_QA_(full_)?(\d+)_(.+)$/.exec(word);
  if (v05Match) {
    const isFull = Boolean(v05Match[1]);
    const sourceWord = v05Match[3];
    return {
      kind: isFull ? 'mlp_v0_5_QA_full' : 'mlp_v0_5_QA',
      sourceWord,
      label: `${isFull ? 'qa_0.5_full' : 'qa_0.5'} ${sourceWord}`,
    };
  }

  const postV05Match = /^post_v0_5_QA_(full_)?(?:mlp_v0_5_QA_(?:full_)?)?(\d+)_(.+)$/.exec(word);
  if (postV05Match) {
    const isFull = Boolean(postV05Match[1]);
    const sourceWord = postV05Match[3];
    return {
      kind: isFull ? 'post_v0_5_QA_full' : 'post_v0_5_QA',
      sourceWord,
      label: `${isFull ? 'post_0.5_full' : 'post_0.5'} ${sourceWord}`,
    };
  }

  const fullMatch = /^mlp_QA_full_(\d+)_(.+)$/.exec(word);
  if (fullMatch) {
    const sourceWord = fullMatch[2];
    return {
      kind: 'mlp_QA_full',
      sourceWord,
      label: `qa_0_full ${sourceWord}`,
    };
  }

  const smokeMatch = /^mlp_QA_(\d+)_(.+)$/.exec(word);
  if (smokeMatch) {
    const sourceWord = smokeMatch[2];
    return {
      kind: 'mlp_QA',
      sourceWord,
      label: `qa_0 ${sourceWord}`,
    };
  }

  return {
    kind: 'source',
    sourceWord: word,
    label: `normal ${word}`,
  };
}

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();

  if (extension === '.json') {
    return 'application/json; charset=utf-8';
  }

  if (extension === '.mp4') {
    return 'video/mp4';
  }

  if (extension === '.glb') {
    return 'model/gltf-binary';
  }

  return 'application/octet-stream';
}
