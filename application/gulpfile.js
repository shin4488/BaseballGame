const path = require('path');
const { series, dest, src, watch } = require('gulp');
const { ESLint } = require('eslint');
const webpack = require('webpack');
const webpackStream = require('webpack-stream');
const webpackConfig = require('./webpack.config');
const { finished } = require('node:stream/promises');
const sass = require('gulp-sass')(require('sass'));
const mode = require('gulp-mode')({
  modes: ['production', 'development'],
  default: 'development',
  verbose: false,
});

const isDevelopment = mode.development();
const outputPath = path.resolve(__dirname, isDevelopment ? 'dist' : 'publish');
const srcPath = path.resolve(__dirname, 'src');

// 画像は文字コード変換せずにコピーし、全ファイルの書き込み完了を待つ。
const copyAssets = async () => {
  await Promise.all([
    finished(
      src(path.resolve(srcPath, 'image', 'favicon.ico'), {
        encoding: false,
      }).pipe(dest(outputPath, { encoding: false })),
    ),
    finished(
      src(path.resolve(srcPath, 'image/**'), { encoding: false }).pipe(
        dest(path.resolve(outputPath, 'image'), { encoding: false }),
      ),
    ),
  ]);
};

const sassTask = () =>
  src('./src/style/*.scss')
    .pipe(sass.sync())
    .pipe(dest(path.resolve(outputPath, 'style')));

// eslint適用
const lint = async () => {
  const eslint = new ESLint({
    overrideConfig: {
      ignorePatterns: ['node_modules/**', 'dist/**', 'publish/**'],
    },
  });
  const results = await eslint.lintFiles(['**/*.js']);
  const formatter = await eslint.loadFormatter('stylish');
  const output = formatter.format(results);
  if (output) {
    process.stdout.write(output);
  }
  if (results.some((result) => result.errorCount > 0)) {
    throw new Error('JavaScript lint failed');
  }
};

// webpack呼び出し
const bundle = () =>
  webpackStream(
    webpackConfig(undefined, {
      mode: isDevelopment ? 'development' : 'production',
    }),
    webpack,
  ).pipe(dest(outputPath));

const startDevServer = async () => {
  const { createDevServer } = require('./dev-server.cjs');
  const server = createDevServer();
  await server.start();
  // JSはWebpack、画像とSCSSはGulpで監視する。HTML/画像/CSSの変更もライブリロードする。
  watch('./src/**/*.js', lint);
  watch('./src/style/**', sassTask);
  watch('./src/image/**', copyAssets);
};

exports.build = series(lint, bundle, sassTask, copyAssets);
exports.default = series(lint, sassTask, copyAssets, startDevServer);
