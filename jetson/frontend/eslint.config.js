import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import checkFile from 'eslint-plugin-check-file'; //파일명 체크 플러그인 import

export default tseslint.config(
  { ignores: ['dist', 'public'] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      eslintConfigPrettier,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'simple-import-sort': simpleImportSort,
      'check-file': checkFile, // 플러그인 등록
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // * import 정렬 규칙
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // * 파일명 규칙 (Jenkins 고려)
      // check-file은 매칭되는 모든 패턴을 검사하므로, 패턴이 겹치지 않게 폴더별로 명시
      'check-file/filename-naming-convention': [
        'error',
        {
          // 컴포넌트 → PascalCase
          'src/App.{ts,tsx}': 'PASCAL_CASE',
          'src/components/**/*.{ts,tsx}': 'PASCAL_CASE',
          'src/pages/**/*.{ts,tsx}': 'PASCAL_CASE',
          // 비-컴포넌트 → camelCase (PASCAL 영역과 겹치지 않게 폴더별로)
          'src/main.{ts,tsx}': 'CAMEL_CASE',
          'src/app/**/*.{ts,tsx}': 'CAMEL_CASE',
          'src/hooks/**/*.{ts,tsx}': 'CAMEL_CASE',
          'src/lib/**/*.{ts,tsx}': 'CAMEL_CASE',
          'src/utils/**/*.{ts,tsx}': 'CAMEL_CASE',
        },
        {
          // index.ts 같은 파일은 예외 처리하지 않아도 규칙에 맞으면 통과됨
          // 파일 중간의 확장자(.test.tsx 등)는 무시
          ignoreMiddleExtensions: true,
        },
      ],
      // * 폴더명 규칙
      'check-file/folder-naming-convention': [
        'error',
        {
          'src/**/': 'KEBAB_CASE', // ? src 하위 폴더: kebab-case
        },
      ],

      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      '@typescript-eslint/no-unused-vars': 'warn',

      '@typescript-eslint/no-explicit-any': 'error',

      'no-console': 'off',
    },
  },
);
