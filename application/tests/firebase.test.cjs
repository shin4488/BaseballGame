const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');
function load(file, dependencies) {
  const exports = {};
  const code = babel.transformFileSync(file, {
    presets: ['@babel/preset-env'],
    babelrc: false,
    configFile: false,
  }).code;
  vm.runInNewContext(code, {
    exports,
    Date,
    Math,
    window: { Promise },
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  });
  return exports;
}
function database() {
  const reads = [],
    writes = [],
    deletes = [],
    snapshots = [];
  const sdk = {
    initializeFirestore: (_app, options) => {
      assert.equal(options.ignoreUndefinedProperties, true);
      return 'database';
    },
    collection: (db, name) => ({ db, name }),
    query: (ref, ...constraints) => ({ ...ref, constraints }),
    orderBy: (field, direction = 'asc') => ({
      kind: 'order',
      field,
      direction,
    }),
    startAt: (...values) => ({ kind: 'start', values }),
    limit: (value) => ({ kind: 'limit', value }),
    getDocs: async (query) => {
      reads.push(query);
      const next = snapshots.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    doc: (db, name, id) => ({ db, name, id }),
    setDoc: async (ref, data, options) => {
      writes.push({ ref, data, options });
    },
    deleteDoc: async (ref) => {
      deletes.push(ref);
    },
  };
  const exported = load('src/application/firebase/database.js', {
    'firebase/firestore': sdk,
    'firebase/app': { getApp: () => 'app' },
  });
  return {
    ...exported,
    store: new exported.FireStore('database', 'guests'),
    reads,
    writes,
    deletes,
    snapshots,
    snapshot: (items) => ({
      size: items.length,
      docs: items.map((data) => ({ data: () => data })),
    }),
  };
}
test('歴代ランキングは得点降順・日時昇順の上位10件を要求する', async () => {
  const d = database();
  const rows = [{ userId: 'first', point: 20 }];
  d.snapshots.push(d.snapshot(rows));
  assert.deepEqual(await d.store.getRankingHistory(), rows);
  assert.equal(d.reads[0].name, 'guests');
  assert.deepEqual(d.reads[0].constraints, [
    { kind: 'order', field: 'point', direction: 'desc' },
    { kind: 'order', field: 'lastUpdated', direction: 'asc' },
    { kind: 'limit', value: 10 },
  ]);
});
test('空の今週ランキングは追加クエリを送らない', async () => {
  const d = database();
  d.snapshots.push(d.snapshot([]));
  assert.equal((await d.store.getRankingThisWeek()).length, 0);
  assert.equal(d.reads.length, 1);
});
test('今週は7日前と最高得点を境界に取得し、仮登録を除く', async () => {
  const d = database(),
    before = Date.now();
  d.snapshots.push(
    d.snapshot([{ point: 25 }]),
    d.snapshot([{ point: 25 }, { point: 0 }, { point: -1 }, {}]),
  );
  assert.deepEqual(
    (await d.store.getRankingThisWeek()).map((x) => x.point),
    [25, 0],
  );
  const c = d.reads[1].constraints;
  assert.deepEqual(c.slice(0, 2), [
    { kind: 'order', field: 'lastUpdated', direction: 'asc' },
    { kind: 'order', field: 'point', direction: 'desc' },
  ]);
  assert.equal(c[2].values[1], 25);
  assert.ok(
    Math.abs(c[2].values[0].getTime() - (before - 7 * 86400000)) < 1000,
  );
});
test('保存は同じIDへマージし、削除は指定IDだけを対象にする', async () => {
  const d = database();
  await d.store.upsertRanking({
    documentId: 'guest-1',
    userName: 'ゲスト1',
    point: 10,
  });
  assert.deepEqual(d.writes[0].ref, {
    db: 'database',
    name: 'guests',
    id: 'guest-1',
  });
  assert.equal(d.writes[0].options.merge, true);
  assert.equal(d.writes[0].data.userId, 'guest-1');
  assert.equal(d.writes[0].data.point, 10);
  assert.ok(d.writes[0].data.lastUpdated instanceof Date);
  await d.store.deleteRanking('guest-2');
  assert.deepEqual(d.deletes, [
    { db: 'database', name: 'guests', id: 'guest-2' },
  ]);
});
test('読み取り失敗を従来のメッセージで伝える', async () => {
  for (const [method, message] of [
    ['getRankingHistory', 'Ranking Fetch Error2'],
    ['getRankingThisWeek', 'Ranking Fetch Error1'],
  ]) {
    const d = database();
    d.snapshots.push(new Error('offline'));
    await assert.rejects(d.store[method](), { message });
  }
});
test('ゲストとログインユーザーの保存先を分離する', () => {
  const d = database();
  d.FireStoreExtention.init();
  assert.equal(d.FireStoreExtention.guestStore._collection, 'guests');
  assert.equal(d.FireStoreExtention.loginUserStore._collection, 'loginUsers');
});
function auth() {
  let listener;
  const current = {},
    calls = [];
  const sdk = {
    getAuth: () => current,
    onAuthStateChanged: (a, fn) => {
      assert.equal(a, current);
      listener = fn;
    },
    GoogleAuthProvider: class {},
    signInWithPopup: async (a, provider) => {
      calls.push({ a, provider });
      return {
        user: { uid: 'user-1', displayName: '表示名', photoURL: 'icon' },
      };
    },
    signOut: async (a) => {
      calls.push({ signOut: a });
    },
  };
  const { FirebaseAuth } = load('src/application/firebase/auth.js', {
    'firebase/auth': sdk,
    'regenerator-runtime/runtime.js': {},
  });
  return {
    handler: new FirebaseAuth(),
    sdk,
    current,
    calls,
    notify: (user) => listener(user),
  };
}
test('認証初期化は状態通知を待ち、未ログイン情報を消去する', async () => {
  const a = auth();
  const ready = a.handler.watchStateChanged();
  a.notify(null);
  await ready;
  assert.equal(a.handler.isLoggedIn(), false);
  assert.equal(a.handler.getLoginUserName(), null);
});
test('Google認証のID・表示名・アイコンとログアウトを維持する', async () => {
  const a = auth();
  await a.handler.signInWithPopupToGoogle();
  assert.equal(a.handler.getLoginUserId(), 'user-1');
  assert.equal(a.handler.getLoginUserName(), '表示名');
  assert.equal(a.handler.getLoginUserIconImage(), 'icon');
  assert.equal(a.calls[0].a, a.current);
  assert.ok(a.calls[0].provider instanceof a.sdk.GoogleAuthProvider);
  await a.handler.signOutFromGoogle();
  assert.equal(a.calls[1].signOut, a.current);
});
test('Google認証のキャンセルを成功扱いしない', async () => {
  const a = auth();
  a.sdk.signInWithPopup = async () => {
    throw new Error('cancelled');
  };
  await assert.rejects(a.handler.signInWithPopupToGoogle(), {
    message: 'cancelled',
  });
});
