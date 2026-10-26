const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');

// 的の候補を区別できるように7つ用意し、Math.randomで先頭から順に選ぶ。選び直すと、表示中とは別の候補が選ばれる。
const boardCandidates = Array.from({ length: 7 }, (_, i) => ({
  text: `的${i}`,
}));
function fixture(width, height) {
  const element = { clientWidth: width, clientHeight: height };
  const listeners = new Map();
  const window = {
    document: { documentElement: element },
    addEventListener: (event, listener) => listeners.set(event, listener),
    removeEventListener: (event, listener) => {
      if (listeners.get(event) === listener) listeners.delete(event);
    },
  };
  let draws = 0;
  const math = Object.create(Math, {
    random: { value: () => ((draws++ % 7) + 0.5) / 7 },
  });
  const { code } = babel.transformFileSync('src/application/vue/index.js', {
    presets: [['@babel/preset-env', { modules: 'commonjs' }]],
    babelrc: false,
    configFile: false,
  });
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    window,
    Math: math,
    setTimeout: () => {},
    Vue: function (options) {
      return options;
    },
    require: (name) =>
      name === './appConfig'
        ? { boardItems: boardCandidates }
        : name === '../firebase/auth'
          ? {
              FirebaseAuthExtention: {
                auth: {
                  getLoginUserName: () => 'player',
                  getLoginUserId: () => 'player-id',
                },
              },
            }
          : name === '../firebase/database'
            ? {
                FireStoreExtention: {
                  getRankingHistory: async () => [],
                  getRankingThisWeek: async () => [],
                },
              }
            : {},
  });
  const options = exports.createVueInstance();
  const app = { ...options.data };
  for (const [key, getter] of Object.entries(options.computed))
    Object.defineProperty(app, key, { get: () => getter.call(app) });
  for (const [key, method] of Object.entries(options.methods))
    app[key] = method.bind(app);
  return {
    app,
    listeners,
    options,
    mount: () => options.mounted.call(app),
    resize: (newWidth, newHeight) => {
      element.clientWidth = newWidth;
      element.clientHeight = newHeight;
      listeners.get('resize')();
    },
  };
}
// 描画するスタイルから、pxで指定した値を読む。
const px = (style, property) =>
  Number(new RegExp(`(?:^|[;\\s])${property}: (-?[\\d.]+)px`).exec(style)[1]);
test('画面縮小と回転に追従し、打撃ボタンとバットを画面内に保つ', () => {
  const f = fixture(1280, 720);
  f.mount();
  const hitButtonTop = () => px(f.app.hitButtonStyleComputed, 'top');
  const batBottom = () =>
    px(f.app.batStyleComputed, 'top') + px(f.app.batStyleComputed, 'height');
  assert.equal(hitButtonTop(), 660);
  const shown = [...f.app.boardItems];
  f.resize(390, 600);
  assert.equal(hitButtonTop(), 540);
  assert.equal(batBottom(), 540);
  assert.deepEqual(
    [...f.app.boardItems],
    shown.slice(0, 2),
    '的を減らすときは表示中の的を残す',
  );
  f.resize(844, 390);
  assert.equal(hitButtonTop(), 330);
  assert.equal(f.app.boardItems.length, 4);
  assert.deepEqual(
    [...f.app.boardItems].slice(0, 2),
    shown.slice(0, 2),
    '的を増やすときは表示中の的を残す',
  );
  f.options.beforeDestroy.call(f.app);
  assert.equal(f.listeners.has('resize'), false);
});
for (const [width, count] of [
  [320, 2],
  [390, 2],
  [449, 2],
  [450, 3],
  [599, 3],
  [600, 4],
  [1280, 4],
]) {
  test(`幅${width}pxで150pxの的が画面に収まる`, () => {
    const f = fixture(width, 720);
    f.mount();
    assert.equal(f.app.boardItems.length, count);
    assert.ok(count * 150 <= width);
    const shown = [...f.app.boardItems];
    f.resize(width, 600);
    assert.deepEqual(
      [...f.app.boardItems],
      shown,
      '高さだけが変わっても的を選び直さない',
    );
  });
}

for (const [loginUserName, guestNumber, expected] of [
  [null, 701, 'ゲスト701'],
  [null, null, 'ゲスト'],
  ['山田', null, '山田'],
  ['', null, 'プレイヤー'],
]) {
  test(`スコアの名前表示: ${expected}`, () => {
    const { app } = fixture(390, 844);
    app.loginUserName = loginUserName;
    app.guestNumber = guestNumber;
    assert.equal(app.playerNameComputed, expected);
  });
}
test('的の高さをボールの直径と同じ40pxにする', () => {
  const { app } = fixture(390, 844);
  assert.match(app.boardItemStyleComputed, /height: 40px/);
});

test('番号取得中は未発番の番号やnullを名前に表示しない', () => {
  const { app } = fixture(390, 844);
  app.loginUserName = null;
  app.guestNumber = null;
  app.isPreparingGuest = true;
  assert.equal(app.playerNameComputed, '番号を取得中…');
  assert.doesNotMatch(app.userMessageComputed, /null/);
});
