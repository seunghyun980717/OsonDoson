import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import checkFile from 'eslint-plugin-check-file';

export default tseslint.config(
  { ignores: ['dist', 'public'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, eslintConfigPrettier],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
      'check-file': checkFile,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      'check-file/filename-naming-convention': [
        'error',
        {
          'src/App.{ts,tsx}': 'PASCAL_CASE',
          'src/components/**/*.{ts,tsx}': 'PASCAL_CASE',
          'src/pages/**/*.{ts,tsx}': 'PASCAL_CASE',
          'src/main.{ts,tsx}': 'CAMEL_CASE',
          // src/app은 라우터/프로바이더 같은 모듈. 컨벤션 충돌(Router.tsx Pascal vs camel) 회피 위해
          // 이 디렉토리는 lint 룰에서 제외 (KEBAB_CASE는 folder rule이 별도로 검증).
          // 'src/app/**/*.{ts,tsx}' 는 의도적으로 미지정.
          'src/hooks/**/*.{ts,tsx}': 'CAMEL_CASE',
          'src/lib/**/*.{ts,tsx}': 'CAMEL_CASE',
          'src/utils/**/*.{ts,tsx}': 'CAMEL_CASE',
          'src/constants/**/*.{ts,tsx}': 'CAMEL_CASE',
          'src/contexts/**/*.{ts,tsx}': 'PASCAL_CASE',
          'src/types/**/*.{ts,tsx}': 'CAMEL_CASE',
        },
        {
          ignoreMiddleExtensions: true,
        },
      ],
      'check-file/folder-naming-convention': [
        'error',
        {
          'src/**/': 'KEBAB_CASE',
        },
      ],

      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
    },
  },
);
