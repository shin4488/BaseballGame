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
test('ゲストIDは暗号学的乱数を使い、連番とともに保存する', async () => {
  const d = database({
    getRandomValues: (bytes) => {
      bytes.fill(171);
      return bytes;
    },
  });
  d.snapshots.push(d.snapshot([]));
  const id = await d.store.createUserId();
  assert.equal(id.guestCountWithPadding, '0000000001');
  assert.equal(d.reads.length, 0);
  assert.equal(d.counts.length, 1);
  assert.equal(id.randomString, 'ab'.repeat(16));
  assert.equal(
    d.writes[0].ref.id,
    `${id.guestCountWithPadding}${id.randomString}`,
  );
});

test('安全な乱数が使えない場合はIDを保存しない', async () => {
  const d = database({
    getRandomValues: () => {
      throw new Error('unavailable');
    },
  });
  d.snapshots.push(d.snapshot([]));
  await assert.rejects(d.store.createUserId(), {
    message: 'Create Id Error',
  });
  assert.equal(d.writes.length, 0);
});

test('ゲストIDは保存が完了するまで返さない', async () => {
  const d = database();
  d.snapshots.push(d.snapshot([]));
  let finishWrite;
  d.sdk.setDoc = () =>
    new Promise((resolve) => {
      finishWrite = resolve;
    });
  let completed = false;
  const creating = d.store.createUserId().then((id) => {
    completed = true;
    return id;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(completed, false);
  finishWrite();
  const id = await creating;
  assert.match(id.randomString, /^[0-9a-f]{32}$/);
});

test('ゲストIDの保存失敗は呼び出し元に伝える', async () => {
  const d = database();
  d.snapshots.push(d.snapshot([]));
  d.sdk.setDoc = async () => {
    throw new Error('permission-denied');
  };
  await assert.rejects(d.store.createUserId(), { message: 'Create Id Error' });
});

test('読み取り失敗時には乱数生成も保存も行わない', async () => {
  let randomCalled = false;
  const d = database({
    getRandomValues: () => {
      randomCalled = true;
    },
  });
  d.snapshots.push(new Error('offline'));
  await assert.rejects(d.store.createUserId(), { message: 'Create Id Error' });
  assert.equal(randomCalled, false);
  assert.equal(d.writes.length, 0);
});

test('同じ件数を読んだ同時作成でも異なるIDを保存する', async () => {
  let sequence = 0;
  const d = database({ getRandomValues: (bytes) => bytes.fill(sequence++) });
  d.snapshots.push(d.snapshot([]), d.snapshot([]));
  const ids = await Promise.all([
    d.store.createUserId(),
    d.store.createUserId(),
  ]);
  assert.equal(ids[0].guestCountWithPadding, ids[1].guestCountWithPadding);
  assert.equal(ids[0].randomString, '00'.repeat(16));
  assert.equal(ids[1].randomString, '01'.repeat(16));
  assert.notEqual(d.writes[0].ref.id, d.writes[1].ref.id);
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

test('画面は42文字のゲストIDを保持し、保存完了後にゲームを始める', async () => {
  const d = database({ getRandomValues: (bytes) => bytes.fill(255) });
  d.snapshots.push(d.snapshot([]));
  let finishWrite;
  d.sdk.setDoc = () =>
    new Promise((resolve) => {
      finishWrite = resolve;
    });
  const screen = guestScreen(d.store);
  const starting = screen.onClickGuestStart();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(screen.hasStarted(), false);
  assert.equal(screen.guestUserId, null);
  finishWrite();
  await starting;
  assert.equal(screen.guestUserId, `0000000001${'ff'.repeat(16)}`);
  assert.equal(screen.guestNumber, 1);
  assert.equal(screen.hasStarted(), true);
});

test('画面はゲスト保存失敗時にIDを設定せずゲームを始めない', async () => {
  const d = database();
  d.snapshots.push(d.snapshot([]));
  d.sdk.setDoc = async () => {
    throw new Error('offline');
  };
  const screen = guestScreen(d.store);
  await screen.onClickGuestStart();
  assert.match(screen.startError, /開始できませんでした/);
  assert.equal(screen.isStartingGame, false);
  assert.equal(screen.guestUserId, null);
  assert.equal(screen.hasStarted(), false);
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

test('ゲスト開始を連打しても登録は1回、登録後に開始する', async () => {
  let count = 0, finish;
  const screen = guestScreen({createUserId: () => {count++; return new Promise(r => {finish = r;});}});
  const first = screen.onClickGuestStart();
  await flush();
  await screen.onClickGuestStart();
  assert.equal(count, 1);
  assert.equal(screen.hasStarted(), false);
  finish({guestCountWithPadding: '0000000007', randomString: 'ab'.repeat(16)});
  await first;
  assert.equal(screen.hasStarted(), true);
  assert.equal(screen.guestNumber, 7);
  assert.equal(screen.isStartingGame, false);
});
