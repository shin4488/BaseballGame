const path = require('node:path');
const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const webpackConfig = require('./webpack.config');

exports.createDevServer = ({ port = 4000, open = true } = {}) => {
  const compiler = webpack(webpackConfig(undefined, { mode: 'development' }));
  return new WebpackDevServer(
    {
      host: 'localhost',
      port,
      open,
      hot: false,
      liveReload: true,
      client: { overlay: false },
      static: { directory: path.resolve(__dirname, 'dist'), watch: true },
      // nginx経由の従来の配信でも最新のバンドルを利用できるようにする。
      devMiddleware: { writeToDisk: true },
    },
    compiler,
  );
};
