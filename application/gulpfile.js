const path = require('path');
const { series, dest, src, watch } = require('gulp');
const eslint = require('gulp-eslint');
const webpack = require('webpack');
const webpackStream = require('webpack-stream');
const webpackConfig = require('./webpack.config');
const webserver = require('gulp-webserver');
const sass = require('gulp-sass');
const mode = require('gulp-mode')({
  modes: ['production', 'development'],
  default: 'development',
  verbose: false,
});

const isDevelopment = mode.development();
const outputPath = path.resolve(__dirname, isDevelopment ? 'dist' : 'publish');
const srcPath = path.resolve(__dirname, 'src');

// ブラウザ起動
const brawserTask = (done) => {
  // アイコンファイルをdistに配置
  src(path.resolve(srcPath, 'image', 'favicon.ico')).pipe(dest(outputPath));
  // 画像フォルダをdistに配置
  src(path.resolve(srcPath, 'image/**')).pipe(
    dest(path.resolve(outputPath, 'image')),
  );
  src(outputPath, { allowEmpty: true }).pipe(
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
    .pipe(dest(path.resolve(outputPath, 'style')));
  done();
};

// eslint適用
const lint = (done) => {
  src(['**/*.js', '!node_modules/**', '!dist/**', '!publish/**'])
    .pipe(eslint({ useEslintrc: true }))
    .pipe(eslint.format())
    .pipe(eslint.failAfterError())
    .on('error', () => {});
  done();
};

// webpack呼び出し
const bundle = (done) => {
  // webpackconfigに引数を渡す必要がある
  webpackStream(
    webpackConfig(undefined, {
      mode: isDevelopment ? 'development' : 'production',
    }),
    webpack,
  ).pipe(dest(outputPath));
  done();
};

// 監視タスク
const watchTask = (done) => {
  watch('./src/**', series(lint, bundle, sassTask));
  done();
};

exports.build = series(lint, bundle, sassTask, brawserTask);

// gulpコマンド実行時
exports.default = series(lint, bundle, sassTask, brawserTask, watchTask);
