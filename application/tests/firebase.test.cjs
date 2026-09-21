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
function database(browserCrypto, initialCounter = 700) {
  let counterData = initialCounter === null ? null : {lastNumber: initialCounter};
  let revision = 0;
  const counterWrites = [], transactionReads = [];
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
    getDocsFromServer: async (query) => sdk.getDocs(query),
    runTransaction: async (_db, callback) => {
      // Web SDKの楽観的排他制御を再現し、競合時はコールバックを再実行する。
      for (let attempt = 0; attempt < 100; attempt++) {
        const readRevision = revision;
        const readData = counterData;
        let pending;
        const result = await callback({
          get: async (ref) => {
            transactionReads.push(ref);
            return {exists: () => readData !== null, data: () => readData};
          },
          set: (ref, data) => { pending = {ref, data}; },
        });
        if (readRevision !== revision) continue;
        if (pending) {
          counterData = pending.data;
          revision++;
          counterWrites.push(pending);
        }
        return result;
      }
      throw new Error('aborted');
    },
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
    counterWrites,
    transactionReads,
    snapshot: (items) => ({
      size: items.length,
      docs: items.map((data) => ({ data: () => data })),
    }),
  };
}
test('ゲスト番号は701、702と連番になり、件数集計や全件取得をしない', async () => {
  const d = database({getRandomValues: bytes => bytes.fill(171)});
  const first = await d.store.createUserId();
  const second = await d.store.createUserId();
  assert.equal(first.guestNumberWithPadding, '0000000701');
  assert.equal(second.guestNumberWithPadding, '0000000702');
  assert.equal(first.randomString, 'ab'.repeat(16));
  assert.equal(d.reads.length + d.counts.length + d.writes.length, 0);
  assert.equal(d.counterWrites.length, 2);
  assert.equal(d.counterWrites[0].ref.id, '_sequence');
  assert.deepEqual(Object.keys(d.counterWrites[0].data), ['lastNumber']);
});

test('初回は過去の20文字IDの最大番号を1件だけ取得して引き継ぐ', async () => {
  const d = database(undefined, null);
  d.snapshots.push(d.snapshot([{userId: '0000000700abcdefghij'}]));
  assert.equal((await d.store.createUserId()).guestNumberWithPadding, '0000000701');
  await d.store.createUserId();
  assert.equal(d.reads.length, 1);
  assert.deepEqual(d.reads[0].constraints, [{kind:'order',field:'userId',direction:'desc'},{kind:'limit',value:1}]);
});
test('データがない場合は1から開始する', async () => {
  const d = database(undefined, null);d.snapshots.push(d.snapshot([]));
  assert.equal((await d.store.createUserId()).guestNumberWithPadding, '0000000001');
});
test('保存済みのランダム番号があれば、その最大番号も再利用しない', async () => {
  const d = database(undefined, null);d.snapshots.push(d.snapshot([{userId:'0000932456'+'ab'.repeat(16)}]));
  assert.equal((await d.store.createUserId()).guestNumberWithPadding, '0000932457');
});
test('同時に20人が開始しても競合を再試行し、番号が重複しない', async () => {
  const d = database();
  const ids = await Promise.all(Array.from({length:20},()=>d.store.createUserId()));
  assert.deepEqual(ids.map(id=>Number(id.guestNumberWithPadding)).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>701+i));
  assert.equal(d.counterWrites.length,20);
  assert.ok(d.transactionReads.length > 20,'競合による再試行を通る');
});
test('初回の同時開始でもカウンターを上書きせず連番を発行する', async () => {
  const d = database(undefined,null);
  d.snapshots.push(d.snapshot([{userId:'0000000700abcdefghij'}]),d.snapshot([{userId:'0000000700abcdefghij'}]));
  const ids=await Promise.all([d.store.createUserId(),d.store.createUserId()]);
  assert.deepEqual(ids.map(id=>Number(id.guestNumberWithPadding)).sort(),[701,702]);
});
for(const value of [-1,1.5,'700',NaN,9999999999])test(`不正または上限のカウンター${value}は更新しない`,async()=>{
  const d=database(undefined,value);
  await assert.rejects(d.store.createUserId(),{message:'Create Id Error'});
  assert.equal(d.counterWrites.length,0);
});
test('10桁の最終番号でもIDは42文字を維持する',async()=>{
  const d=database(undefined,9999999998);
  const id=await d.store.createUserId();
  assert.match(id.guestNumberWithPadding+id.randomString,/^9999999999[0-9a-f]{32}$/);
});
test('安全な乱数が使えない場合はカウンターも進めない',async()=>{
  const d=database({getRandomValues:()=>{throw new Error('unavailable');}});
  await assert.rejects(d.store.createUserId(),{message:'Create Id Error'});
  assert.equal(d.transactionReads.length,0);assert.equal(d.counterWrites.length,0);
});
test('初回の既存IDが不正な場合は1からやり直さず失敗する',async()=>{
  const d=database(undefined,null);d.snapshots.push(d.snapshot([{userId:'broken'}]));
  await assert.rejects(d.store.createUserId());assert.equal(d.counterWrites.length,0);
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

test('画面は連番発行後に42文字のゲストIDを保持してゲームを始める', async () => {
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

function rankingScreen(sources, loginUserName = null) {
  const { createVueInstance } = load('src/application/vue/index.js', {
    '../vector/vector2': {},
    '../firebase/auth': { FirebaseAuthExtention: {auth: {getLoginUserName: () => loginUserName}} },
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

test('番号と週間ランキングが取得中でも歴代を表示し、番号が届けば開始画面に保持する', async () => {
  let finishHistory, finishWeek, finishGuest;
  const {app, options} = rankingScreen({
    getRankingHistory: () => new Promise(r => {finishHistory = r;}),
    getRankingThisWeek: () => new Promise(r => {finishWeek = r;}),
    guestStore: {createUserId: () => new Promise(r => {finishGuest = r;})},
  });
  options.mounted.call(app);
  assert.equal(app.shouldShowInitImage, false);
  assert.equal(app.guestUserId, null);
  assert.equal(app.isPreparingGuest, true);
  finishGuest({guestNumberWithPadding: '0000000701', randomString: 'ab'.repeat(16)});
  await flush();
  assert.equal(app.guestNumber, 701);
  assert.equal(app.isPreparingGuest, false);
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

test('発番通信に失敗した場合はランダム番号で開始せず、再試行できる',async()=>{
  const d=database();const transaction=d.sdk.runTransaction;
  d.sdk.runTransaction=async()=>{throw new Error('resource-exhausted');};
  const screen=guestScreen(d.store);await screen.onClickGuestStart();
  assert.equal(screen.hasStarted(),false);assert.equal(screen.guestUserId,null);
  assert.match(screen.startError,/開始できませんでした/);assert.equal(d.counterWrites.length,0);
  d.sdk.runTransaction=transaction;await screen.onClickGuestStart();
  assert.equal(screen.hasStarted(),true);assert.equal(screen.guestNumber,701);assert.equal(screen.startError,'');
});
test('同じゲストで再度開始する場合は番号を再発行しない',async()=>{
  const d=database();const screen=guestScreen(d.store);
  await screen.onClickGuestStart();const first=screen.guestUserId;
  await screen.onClickGuestStart();assert.equal(screen.guestUserId,first);assert.equal(d.counterWrites.length,1);
});


test('開始画面の発番中に開始を押しても番号を二重発行しない', async () => {
  let calls = 0, finish;
  const screen = guestScreen({createUserId: () => {
    calls++;
    return new Promise(resolve => {finish = resolve;});
  }});
  const preparation = screen.createGuestUser();
  const start = screen.onClickGuestStart();
  await flush();
  assert.equal(calls, 1);
  assert.equal(screen.hasStarted(), false);
  finish({guestNumberWithPadding: '0000000701', randomString: 'ab'.repeat(16)});
  await Promise.all([preparation, start]);
  assert.equal(screen.guestNumber, 701);
  assert.equal(screen.hasStarted(), true);
  await screen.onClickGuestStart();
  assert.equal(calls, 1);
});

test('初回発番の失敗は画面に表示し、取得処理をやり直せる', async () => {
  let fail = true;
  const {app, options} = rankingScreen({
    getRankingHistory: async () => [], getRankingThisWeek: async () => [],
    guestStore: {createUserId: async () => {
      if (fail) throw new Error('offline');
      return {guestNumberWithPadding: '0000000701', randomString: 'ab'.repeat(16)};
    }},
  });
  options.mounted.call(app);
  await flush();
  assert.match(app.startError, /ゲスト番号を取得できませんでした/);
  assert.equal(app.isPreparingGuest, false);
  assert.equal(app.guestUserId, null);
  fail = false;
  await app.createGuestUser();
  assert.equal(app.guestNumber, 701);
});

test('ログイン済みの開始画面ではゲスト番号を発行しない', async () => {
  let calls = 0;
  const {app, options} = rankingScreen({
    getRankingHistory: async () => [], getRankingThisWeek: async () => [],
    guestStore: {createUserId: async () => {calls++;}},
  }, '山田');
  options.mounted.call(app);
  await flush();
  assert.equal(app.loginUserName, '山田');
  assert.equal(calls, 0);
  assert.equal(app.isPreparingGuest, false);
});
