const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const Dotenv = require('dotenv-webpack');

module.exports = (env, argv) => {
  const isDevelopment = argv.mode === 'development';
  const outputDirectory = isDevelopment ? 'dist' : 'publish';

  return {
    // argv.modeにはwebpackのmodeに指定できない値（未指定を含む）が入り得るため、development以外はすべてproductionとして扱う
    mode: isDevelopment ? 'development' : 'production',
    entry: path.resolve(__dirname, 'src', 'main.js'),
    output: {
      filename: 'main.js',
      path: path.resolve(__dirname, outputDirectory),
    },
    devtool: isDevelopment ? 'source-map' : undefined,
    // production時にbundleサイズが大きくなって警告が出るため、maxsizeを大きめにとる
    performance: {
      maxAssetSize: 1000000,
      maxEntrypointSize: 1000000,
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: {
            and: [/node_modules/, /dist/, /publish/, /1.0.*/],
          },
          use: {
            // 対象ブラウザが対応していない構文をBabelで変換する
            loader: 'babel-loader',
            options: {
              presets: [
                // 変換対象のブラウザはBabelの既定（browserslistのdefaults）に従う
                '@babel/preset-env',
                {
                  compact: false,
                },
              ],
            },
          },
        },
      ],
    },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(__dirname, 'src', 'index.html'),
            to: path.resolve(__dirname, outputDirectory, 'index.html'),
          },
        ],
      }),
      new Dotenv(),
    ],
  };
};
