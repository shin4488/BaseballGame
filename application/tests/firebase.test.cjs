const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');
function load(
  file,
  dependencies,
  browserCrypto = globalThis.crypto,
  globals = {},
) {
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
    window: { Promise, crypto: browserCrypto },
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  });
  return exports;
}
function database(browserCrypto) {
  const reads = [],
    writes = [],
    deletes = [],
    snapshots = [],
    counts = [];
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
    getCountFromServer: async (query) => {
      counts.push(query);
      const next = snapshots.shift();
      if (next instanceof Error) throw next;
      return { data: () => ({count: next.size}) };
    },
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
  const exported = load(
    'src/application/firebase/database.js',
    {
      'firebase/firestore': sdk,
      'firebase/app': { getApp: () => 'app' },
    },
    browserCrypto,
  );
  return {
    ...exported,
    sdk,
    store: new exported.FireStore('database', 'guests'),
    reads,
    counts,
    writes,
    deletes,
    snapshots,
    snapshot: (items) => ({
      size: items.length,
      docs: items.map((data) => ({ data: () => data })),
    }),
  };
}
test('ゲストIDを暗号学的乱数だけで発行し、Firestoreを読み書きしない', async () => {
  const d = database({getRandomValues: bytes => {bytes.fill(171); return bytes;}});
  const id = await d.store.createUserId();
  assert.match(id.guestNumberWithPadding, /^\d{10}$/);
  assert.ok(Number(id.guestNumberWithPadding) >= 1 && Number(id.guestNumberWithPadding) <= 999999);
  assert.equal(id.randomString, 'ab'.repeat(16));
  assert.equal(d.reads.length + d.counts.length + d.writes.length, 0);
});

for (const byte of [0, 255]) {
  test(`乱数バイト${byte}でも表示番号は1〜999999、IDは従来の42文字`, async () => {
    const d = database({getRandomValues: bytes => bytes.fill(byte)});
    const id = await d.store.createUserId();
    assert.match(`${id.guestNumberWithPadding}${id.randomString}`, /^\d{10}[0-9a-f]{32}$/);
    assert.ok(Number(id.guestNumberWithPadding) >= 1 && Number(id.guestNumberWithPadding) <= 999999);
  });
}

test('安全な乱数が使えない場合はID発行を失敗させる', async () => {
  const d = database({getRandomValues: () => {throw new Error('unavailable');}});
  await assert.rejects(d.store.createUserId(), {message: 'Create Id Error'});
  assert.equal(d.writes.length, 0);
});

test('同じ表示番号でも128ビットの乱数が異なればIDは異なる', async () => {
  let sequence = 0;
  const d = database({getRandomValues: bytes => {bytes.fill(sequence++, 0, 16); return bytes;}});
  const [a, b] = await Promise.all([d.store.createUserId(), d.store.createUserId()]);
  assert.equal(a.guestNumberWithPadding, b.guestNumberWithPadding);
  assert.notEqual(a.randomString, b.randomString);
  assert.equal(d.writes.length, 0);
});

function guestScreen(store) {
  const { createVueInstance } = load(
    'src/application/vue/index.js',
    {
      '../vector/vector2': {},
      '../firebase/auth': {
        FirebaseAuthExtention: { auth: { signOutFromGoogle: async () => {} } },
      },
      '../firebase/database': { FireStoreExtention: { guestStore: store } },
      './process': {},
      './appConfig': { boardItems: [], guestImagePath: 'guest.png' },
      'regenerator-runtime/runtime.js': {},
    },
    undefined,
    {
      window: { document: { documentElement: { clientWidth: 1280, clientHeight: 720 } } },
      Vue: function (options) {
        return options;
      },
    },
  );
  const options = createVueInstance();
  let started = false;
  return {
    ...options.data,
    ...options.methods,
    executeBaseballGame: () => {
      started = true;
    },
    hasStarted: () => started,
  };
}

test('画面は42文字のゲストIDを保持し、登録通信を待たずゲームを始める', async () => {
  const d = database();
  const screen = guestScreen(d.store);
  await screen.onClickGuestStart();
  assert.match(screen.guestUserId, /^\d{10}[0-9a-f]{32}$/);
  assert.ok(screen.guestNumber >= 1 && screen.guestNumber <= 999999);
  assert.equal(screen.hasStarted(), true);
  assert.equal(d.writes.length, 0);
});

test('ID生成失敗は画面で通知し、再試行できる', async () => {
  let fail = true;
  const d = database({getRandomValues: bytes => {if (fail) throw new Error('unavailable'); return bytes.fill(0);}});
  const screen = guestScreen(d.store);
  await screen.onClickGuestStart();
  assert.equal(screen.hasStarted(), false);
  assert.equal(screen.guestUserId, null);
  assert.match(screen.startError, /開始できませんでした/);
  assert.equal(screen.isStartingGame, false);
  fail = false;
  await screen.onClickGuestStart();
  assert.equal(screen.hasStarted(), true);
  assert.equal(screen.startError, '');
});

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
test('今週は7日前から1回だけ取得し、仮登録を除く', async () => {
  const d = database(),
    before = Date.now();
  d.snapshots.push(
    d.snapshot([{ point: 25 }, { point: 0 }, { point: -1 }, {}]),
  );
  assert.deepEqual(
    (await d.store.getRankingThisWeek()).map((x) => x.point),
    [25, 0],
  );
  assert.equal(d.reads.length, 1);
  const c = d.reads[0].constraints;
  assert.deepEqual(c.slice(0, 2), [
    { kind: 'order', field: 'lastUpdated', direction: 'asc' },
    { kind: 'order', field: 'point', direction: 'desc' },
  ]);
  assert.equal(c[2].values.length, 1);
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

for (const method of ['getRankingHistory', 'getRankingThisWeek']) {
  test(`${method}は両コレクションを同時取得し、得点・日時順の上位10件を返す`, async () => {
    const d = database();
    let finishGuests, finishUsers;
    d.FireStoreExtention.guestStore = { [method]: () => new Promise(r => { finishGuests = r; }) };
    d.FireStoreExtention.loginUserStore = { [method]: () => new Promise(r => { finishUsers = r; }) };
    const pending = d.FireStoreExtention[method]();
    assert.equal(typeof finishGuests, 'function');
    assert.equal(typeof finishUsers, 'function');
    finishGuests(Array.from({length: 10}, (_,i) => ({point: i, lastUpdated: new Date(1000)})));
    finishUsers([{point: 9, lastUpdated: new Date(0)}, {point: 20, lastUpdated: new Date(0)}]);
    const result = await pending;
    assert.equal(result.length, 10);
    assert.equal(result[0].point, 20);
    assert.equal(result[1].point, 9);
    assert.equal(result[1].lastUpdated.getTime(), 0);
    assert.equal(result[2].lastUpdated.getTime(), 1000);
  });
}

function rankingScreen(sources) {
  const { createVueInstance } = load('src/application/vue/index.js', {
    '../vector/vector2': {},
    '../firebase/auth': { FirebaseAuthExtention: {auth: {getLoginUserName: () => null}} },
    '../firebase/database': { FireStoreExtention: sources },
    './process': {}, './appConfig': {boardItems: []}, 'regenerator-runtime/runtime.js': {},
  }, undefined, {
    window: {document: {documentElement: {clientWidth: 390, clientHeight: 844}}, addEventListener: () => {}},
    Vue: function(options) { return options; },
  });
  const options = createVueInstance();
  const app = {...options.data, ...options.methods, mapFirestoreToRankingTable: async rows => rows};
  return {app, options};
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('遅い週間ランキングを待たず歴代を表示し、初回表示でゲストを作らない', async () => {
  let finishHistory, finishWeek;
  const {app, options} = rankingScreen({
    getRankingHistory: () => new Promise(r => {finishHistory = r;}),
    getRankingThisWeek: () => new Promise(r => {finishWeek = r;}),
    guestStore: {createUserId: () => {throw new Error('Initial guest creation is forbidden');}},
  });
  options.mounted.call(app);
  assert.equal(app.shouldShowInitImage, false);
  assert.equal(app.guestUserId, null);
  assert.equal(typeof finishWeek, 'function');
  finishHistory([{point: 21}]);
  await flush();
  assert.equal(app.rankings.history.dataList[0].point, 21);
  assert.equal(app.rankings.history.isLoading, false);
  assert.equal(app.rankings.thisWeek.isLoading, true);
  finishWeek([]);
  await flush();
  assert.equal(app.rankings.thisWeek.isLoading, false);
});

test('片方の取得失敗でも他方を表示し、再取得できる', async () => {
  let fail = true;
  const {app} = rankingScreen({
    getRankingHistory: async () => [{point: 12}],
    getRankingThisWeek: async () => {if (fail) throw new Error('offline'); return [{point: 7}];},
  });
  await app.initializeTopMenuData();
  assert.equal(app.rankings.history.dataList[0].point, 12);
  assert.ok(app.rankings.thisWeek.error);
  assert.equal(app.rankings.thisWeek.isLoading, false);
  fail = false;
  await app.initializeTopMenuData();
  assert.equal(app.rankings.thisWeek.error, '');
  assert.equal(app.rankings.thisWeek.dataList[0].point, 7);
});

test('古い応答で新しいランキングを上書きしない', async () => {
  const pending = [];
  const {app} = rankingScreen({getRankingHistory: () => new Promise(r => pending.push(r)), getRankingThisWeek: async () => []});
  const old = app.initializeTopMenuData();
  const current = app.initializeTopMenuData();
  pending[1]([{point: 20}]);
  await current;
  pending[0]([{point: 1}]);
  await old;
  assert.equal(app.rankings.history.dataList[0].point, 20);
});

test('ゲスト開始を連打してもID発行は1回、発行後に開始する', async () => {
  let count = 0, finish;
  const screen = guestScreen({createUserId: () => {count++; return new Promise(r => {finish = r;});}});
  const first = screen.onClickGuestStart();
  await flush();
  await screen.onClickGuestStart();
  assert.equal(count, 1);
  assert.equal(screen.hasStarted(), false);
  finish({guestNumberWithPadding: '0000000007', randomString: 'ab'.repeat(16)});
  await first;
  assert.equal(screen.hasStarted(), true);
  assert.equal(screen.guestNumber, 7);
  assert.equal(screen.isStartingGame, false);
});

test('Firestoreの利用枠が尽きてもゲスト開始は読み書きせず成功する', async () => {
  const d = database();
  const calls = [];
  for (const method of ['getDocs', 'getCountFromServer', 'setDoc']) {
    d.sdk[method] = async () => { calls.push(method); throw new Error('resource-exhausted'); };
  }
  const screen = guestScreen(d.store);
  await screen.onClickGuestStart();
  assert.equal(screen.hasStarted(), true);
  assert.match(screen.guestUserId, /^\d{10}[0-9a-f]{32}$/);
  assert.equal(screen.startError, '');
  assert.deepEqual(calls, []);
});
