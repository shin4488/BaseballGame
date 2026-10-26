const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');
// Firestoreが日時のフィールドを返すときの型。接続はしない。
const { Timestamp } = require('firebase/firestore');

function fixture({ loggedIn = false, save } = {}) {
  const calls = [];
  const alerts = [];
  // 書き込みが完了した記録。ランキングの取得では、これをFirestoreのドキュメントの形で返す。
  const saved = [];
  const store = (kind) => ({
    upsertRanking: async (data) => {
      calls.push({ kind, ...data });
      await save();
      saved.push(data);
    },
  });
  const ranking = async () =>
    saved.map((data) => ({
      userId: data.documentId,
      userName: data.userName,
      userIconImageUrl: data.userIconImageUrl,
      point: data.point,
      lastUpdated: Timestamp.fromDate(new Date(2026, 9, 26, 12)),
    }));
  const auth = {
    isLoggedIn: () => loggedIn,
    getLoginUserId: () => (loggedIn ? 'player-id' : null),
    getLoginUserName: () => 'プレイヤー',
    getLoginUserIconImage: () => 'player.png',
  };
  const { code } = babel.transformFileSync('src/application/vue/index.js', {
    presets: [['@babel/preset-env', { modules: 'commonjs' }]],
    babelrc: false,
    configFile: false,
  });
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    Vue: function (options) {
      return options;
    },
    setTimeout: () => {},
    window: {
      document: { documentElement: { clientWidth: 1280, clientHeight: 720 } },
      alert: (message) => alerts.push(message),
    },
    require: (name) => {
      if (name === '../firebase/auth')
        return { FirebaseAuthExtention: { auth } };
      if (name === '../firebase/database')
        return {
          FireStoreExtention: {
            guestStore: store('guest'),
            loginUserStore: store('login'),
            getRankingHistory: ranking,
            getRankingThisWeek: ranking,
          },
          FireStoreColumn: {
            userId: 'userId',
            userName: 'userName',
            userIconImageUrl: 'userIconImageUrl',
            point: 'point',
            lastUpdated: 'lastUpdated',
          },
        };
      if (name === './appConfig') return { guestImagePath: 'guest.png' };
      return {};
    },
  });
  const options = exports.createVueInstance();
  // 12点で試合を終え、結果画面を表示している状態
  const app = {
    ...options.data,
    point: 12,
    guestUserId: 'guest-id',
    guestNumber: 624,
    shouldShowResult: true,
  };
  for (const [name, method] of Object.entries(options.methods)) {
    app[name] = method.bind(app);
  }
  // 開始画面のランキングに表示している、プレイヤー名と得点
  const shownRanking = (key) =>
    app.rankings[key].dataList.map((row) => `${row.playerName} ${row.point}`);
  return { app, calls, alerts, shownRanking };
}

for (const loggedIn of [false, true]) {
  test(`${loggedIn ? 'ログイン' : 'ゲスト'}の保存完了まで結果を維持し、連打と画面遷移を防ぐ`, async () => {
    let resolve;
    const f = fixture({
      loggedIn,
      save: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const pending = f.app.onClickSaveButton();
    assert.equal(f.app.shouldShowResult, true);
    const repeated = f.app.onClickSaveButton();
    f.app.onClickFinishButton();
    f.app.onClickRetryButton();
    assert.equal(f.calls.length, 1);
    assert.equal(f.app.shouldShowResult, true);
    assert.equal(f.calls[0].documentId, loggedIn ? 'player-id' : 'guest-id');
    assert.equal(f.calls[0].point, 12);
    assert.equal(f.calls[0].kind, loggedIn ? 'login' : 'guest');
    resolve();
    await Promise.all([pending, repeated]);
    assert.equal(f.app.shouldShowResult, false);
    const player = loggedIn ? 'プレイヤー' : 'ゲスト624';
    assert.deepEqual(f.shownRanking('history'), [`${player} 12`]);
    assert.deepEqual(f.shownRanking('thisWeek'), [`${player} 12`]);
    assert.equal(f.app.isSavingResult, false);
  });
}
test('保存失敗は結果と得点を残し、再試行できる', async () => {
  let fail = true;
  const f = fixture({
    save: async () => {
      if (fail) throw new Error('offline');
    },
  });
  await f.app.onClickSaveButton();
  assert.equal(f.app.shouldShowResult, true);
  assert.equal(f.app.point, 12);
  assert.equal(f.alerts.length, 1);
  assert.equal(f.app.isSavingResult, false);
  fail = false;
  await f.app.onClickSaveButton();
  assert.equal(f.calls.length, 2);
  assert.equal(f.app.shouldShowResult, false);
  assert.deepEqual(f.shownRanking('history'), ['ゲスト624 12']);
});
