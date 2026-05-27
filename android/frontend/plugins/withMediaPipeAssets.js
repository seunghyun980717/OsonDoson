// MediaPipe 모델 파일(.task)을 prebuild 시 android/app/src/main/assets/로 복사한다.
// react-native-mediapipe + 우리가 patch로 추가한 HandLandmarker가 native에서 setModelAssetPath로
// assets 폴더에서 모델을 로드하므로 build 직전에 위치해야 한다.
//
// CNG 패턴 유지 — android/ 디렉터리는 .gitignored, 매 prebuild마다 plugin이 자동 복사.
// 모델 파일 자체는 assets/mediapipe/에 두고 git에 commit (~13MB).

const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

module.exports = function withMediaPipeAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const platformRoot = config.modRequest.platformProjectRoot;

      const src = path.join(projectRoot, 'assets', 'mediapipe');
      const dst = path.join(platformRoot, 'app', 'src', 'main', 'assets');

      if (!fs.existsSync(src)) {
        console.warn(`[withMediaPipeAssets] source dir not found: ${src}`);
        return config;
      }

      if (!fs.existsSync(dst)) {
        fs.mkdirSync(dst, { recursive: true });
      }

      const files = fs.readdirSync(src).filter((f) => f.endsWith('.task'));
      for (const file of files) {
        const srcFile = path.join(src, file);
        const dstFile = path.join(dst, file);
        fs.copyFileSync(srcFile, dstFile);
        const sizeMb = (fs.statSync(srcFile).size / 1024 / 1024).toFixed(2);
        console.log(`[withMediaPipeAssets] copied ${file} (${sizeMb} MB)`);
      }

      return config;
    },
  ]);
};
