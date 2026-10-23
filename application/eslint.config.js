const js = require('@eslint/js');
const globals = require('globals');
const prettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = [
  {
    ignores: [
      'dist/**',
      'publish/**',
      '.test-browser/**',
      'node_modules/**',
      '1.0.*/**',
    ],
  },
  js.configs.recommended,
  prettierRecommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        window: true,
        Vue: true,
      },
    },
    rules: {
      'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
      'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',
      // 整形の設定はPrettierの設定ファイルに置き、Prettier単体で実行した結果と揃える。
      'prettier/prettier': 'warn',
    },
  },
];
