const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');

function fixture({ loggedIn = false, save } = {}) {
  const calls = [];
  const alerts = [];
  const store = (kind) => ({ upsertRanking: (data) => {
    calls.push({ kind, ...data });
    return save();
  }});
  const auth = {
    isLoggedIn: () => loggedIn,
    getLoginUserId: () => 'player-id',
    getLoginUserName: () => 'プレイヤー',
    getLoginUserIconImage: () => 'player.png',
  };
  const { code } = babel.transformFileSync('src/application/vue/index.js', {
    presets: ['@babel/preset-env'], babelrc: false, configFile: false,
  });
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    Vue: function (options) { return options; },
    window: {
      document: { documentElement: { clientWidth: 1280, clientHeight: 720 } },
      alert: (message) => alerts.push(message),
    },
    require: (name) => {
      if (name === '../firebase/auth') return { FirebaseAuthExtention: { auth } };
      if (name === '../firebase/database') return { FireStoreExtention: {
        guestStore: store('guest'), loginUserStore: store('login'),
      } };
      if (name === './appConfig') return { guestImagePath: 'guest.png' };
      return {};
    },
  });
  const options = exports.createVueInstance();
  let refreshes = 0;
  const app = { ...options.data, point: 12, guestUserId: 'guest-id', guestNumber: 624,
    shouldShowResult: true,
    initializeTopMenuData: async () => { refreshes++; },
  };
  for (const [name, method] of Object.entries(options.methods)) {
    if (name !== 'initializeTopMenuData') app[name] = method.bind(app);
  }
  return { app, calls, alerts, refreshes: () => refreshes };
}

for (const loggedIn of [false, true]) {
  test(`${loggedIn ? 'ログイン' : 'ゲスト'}の保存完了まで結果を維持し、連打と画面遷移を防ぐ`, async () => {
    let resolve;
    const f = fixture({ loggedIn, save: () => new Promise((r) => { resolve = r; }) });
    const pending = f.app.onClickSaveButton();
    assert.equal(f.app.shouldShowResult, true);
    assert.equal(f.refreshes(), 0);
    await f.app.onClickSaveButton();
    f.app.onClickFinishButton();
    f.app.onClickRetryButton();
    assert.equal(f.app.shouldShowResult, true);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].documentId, loggedIn ? 'player-id' : 'guest-id');
    assert.equal(f.calls[0].point, 12);
    assert.equal(f.calls[0].kind, loggedIn ? 'login' : 'guest');
    resolve();
    await pending;
    assert.equal(f.app.shouldShowResult, false);
    assert.equal(f.refreshes(), 1);
    assert.equal(f.app.isSavingResult, false);
  });
}
test('保存失敗は結果と得点を残し、再試行できる', async () => {
  let fail = true;
  const f = fixture({ save: async () => { if (fail) throw new Error('offline'); } });
  await f.app.onClickSaveButton();
  assert.equal(f.app.shouldShowResult, true);
  assert.equal(f.app.point, 12);
  assert.equal(f.refreshes(), 0);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.app.isSavingResult, false);
  fail = false;
  await f.app.onClickSaveButton();
  assert.equal(f.calls.length, 2);
  assert.equal(f.app.shouldShowResult, false);
});
