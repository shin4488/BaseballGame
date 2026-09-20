const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');

function fixture(width, height) {
  const element = { clientWidth: width, clientHeight: height };
  const listeners = new Map();
  const window = { document: { documentElement: element },
    addEventListener: (event, listener) => listeners.set(event, listener),
    removeEventListener: (event, listener) => {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
  };
  const { code } = babel.transformFileSync('src/application/vue/index.js', {
    presets: ['@babel/preset-env'], babelrc: false, configFile: false,
  });
  const exports = {};
  vm.runInNewContext(code, { exports, window, Math, setTimeout: () => {},
    Vue: function(options) { return options; },
    require: (name) => name === './appConfig' ? { boardItems: [{text:'的'}] }
      : name === '../firebase/auth' ? { FirebaseAuthExtention: { auth: {getLoginUserName: () => 'player'} } } : {},
  });
  const options = exports.createVueInstance();
  const app = { ...options.data };
  for (const [key, getter] of Object.entries(options.computed)) Object.defineProperty(app, key, { get: () => getter.call(app) });
  for (const [key, method] of Object.entries(options.methods)) app[key] = method.bind(app);
  app.initializeTopMenuData = () => {};
  return { app, element, listeners, options };
}
test('画面縮小と回転に追従し、打撃ボタンとバットを画面内に保つ', async () => {
  const f = fixture(1280,720);
  await f.options.mounted.call(f.app);
  assert.equal(f.app.hitButtonYPositionComputed,660);
  f.element.clientWidth = 390;
  f.element.clientHeight = 600;
  f.listeners.get('resize')();
  assert.equal(f.app.hitButtonYPositionComputed,540);
  assert.equal(f.app.batYPositionComputed + f.app.batInitHeight,540);
  assert.equal(f.app.boardItems.length,2);
  f.element.clientWidth = 844;
  f.element.clientHeight = 390;
  f.listeners.get('resize')();
  assert.equal(f.app.hitButtonYPositionComputed,330);
  assert.equal(f.app.boardItems.length,4);
  f.options.beforeDestroy.call(f.app);
  assert.equal(f.listeners.has('resize'),false);
});
for (const [width, count] of [[320,2],[390,2],[449,2],[450,3],[599,3],[600,4],[1280,4]]) {
  test(`幅${width}pxで150pxの的が画面に収まる`, () => {
    const { app } = fixture(width,720);
    app.setBoardItems();
    assert.equal(app.boardItems.length,count);
    assert.ok(count * 150 <= width);
    const first = app.boardItems[0];
    app.updateViewport();
    assert.equal(app.boardItems[0],first);
  });
}
