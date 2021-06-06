const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = (env, argv) => {
  const isDevelopment = argv.mode === 'development';

  return {
    // 必ずしもmode指定できる値がargv.modeに入っているとは限らないため文字列で指定している
    // 開発環境以外は全て本番とする
    mode: isDevelopment ? 'development' : 'production',
    entry: path.resolve(__dirname, 'src', 'main.js'),
    output: {
      filename: 'main.js',
      path: path.resolve(__dirname, 'dist'),
    },
    devtool: isDevelopment ? 'source-map' : 'none',
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'src', 'index.html'),
            to: path.resolve(__dirname, 'dist', 'index.html'),
          },
        ],
      }),
      new Dotenv(),
    ],
  };
};
