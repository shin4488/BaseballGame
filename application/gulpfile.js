const path = require('path');
const { series, dest, src, watch } = require('gulp');
const eslint = require('gulp-eslint');
const webpack = require('webpack');
const webpackStream = require('webpack-stream');
const webpackConfig = require('./webpack.config');
const webserver = require('gulp-webserver');
var sass = require('gulp-sass');

const distPath = path.resolve(__dirname, 'dist');
const srcPath = path.resolve(__dirname, 'src');

// 監視タスク
const watchTask = (done) => {
  watch('./src/**', series(lint, bundleDev, sassTask));
  done();
};

// ブラウザ起動
const brawserTask = (done) => {
  // アイコンファイルをdistに配置
  src(path.resolve(srcPath, 'image', 'favicon.ico')).pipe(dest(distPath));
  // 画像フォルダをdistに配置
  src(path.resolve(srcPath, 'image/**')).pipe(
    dest(path.resolve(distPath, 'image')),
  );
  src(distPath, { allowEmpty: true }).pipe(
    webserver({
      port: 4000,
      livereload: true,
      open: true,
    }),
  );
  done();
};

// sass
const sassTask = (done) => {
  src('./src/style/*.scss')
    .pipe(sass.sync())
    .pipe(dest(path.resolve(distPath, 'style')));
  done();
};

// eslint適用
const lint = (done) => {
  src(['**/*.js', '!node_modules/**'])
    .pipe(eslint({ useEslintrc: true }))
    .pipe(eslint.format())
    .pipe(eslint.failAfterError())
    .on('error', () => {});
  done();
};

// webpack呼び出し
const bundleDev = (done) => {
  // webpackconfigに引数を渡す必要がある
  webpackStream(
    webpackConfig(undefined, { mode: 'development' }),
    webpack,
  ).pipe(dest(distPath));
  done();
};

// webpack呼び出し
const bundleProd = (done) => {
  // webpackconfigに引数を渡す必要がある
  webpackStream(webpackConfig(undefined, { mode: 'production' }), webpack).pipe(
    dest(distPath),
  );
  done();
};

exports.build = series(lint, bundleProd, sassTask);

// gulpコマンド実行時
exports.default = series(lint, bundleDev, sassTask, brawserTask, watchTask);
