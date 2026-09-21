// 本番の認証情報・Firebase SDKを含まない、実画面確認用のビルド。
const path = require('node:path');
const fs = require('node:fs');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const sass = require('sass');
const app = path.resolve(__dirname, '../..');
const output = path.join(app, '.test-browser');
const config = require('../../webpack.config.js')({}, {mode:'production'});
config.output.path = output;
config.plugins = [
  new webpack.NormalModuleReplacementPlugin(/firebase\/(auth|database|index)$/, path.join(__dirname, 'firebase.js')),
  new CopyPlugin({patterns:[
    {from:path.join(app,'src/index.html'),to:'index.html'},
    {from:path.join(app,'src/image'),to:'image'},
  ]}),
];
webpack(config, (error, stats) => {
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({all:false,errors:true}));
    process.exitCode = 1;
    return;
  }
  const modules = stats.toJson({all:false,modules:true,nestedModules:true}).modules;
  const containsFirebase = entries => entries.some(module =>
    /node_modules\/(?:@firebase|firebase)\//.test(module.name || '') ||
    containsFirebase(module.modules || []));
  if (containsFirebase(modules)) {
    throw new Error('ブラウザ検証ビルドにFirebase SDKが混入しています');
  }
  fs.mkdirSync(path.join(output,'style'),{recursive:true});
  fs.writeFileSync(path.join(output,'style/index.css'),sass.compile(path.join(app,'src/style/index.scss')).css);
  console.log('Firebaseをモックしたブラウザ確認用ビルド: application/.test-browser');
});
