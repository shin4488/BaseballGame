const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');
// Firestoreが日時のフィールドを保存・返却するときの型。接続はしない。
const { Timestamp } = require('firebase/firestore');
function load(file, dependencies, globals = {}) {
  const exports = {};
  const code = babel.transformFileSync(file, {
    presets: [['@babel/preset-env', { modules: 'commonjs' }]],
    babelrc: false,
    configFile: false,
  }).code;
  vm.runInNewContext(code, {
    exports,
    Date,
    Math,
    window: { Promise },
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  });
  return exports;
}
// 現在時刻は2026年10月15日12時（実行環境のタイムゾーン）に固定する。
const now = new Date(2026, 9, 15, 12, 0);
class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length ? args : [now.getTime()]));
  }
  static now() {
    return now.getTime();
  }
}
const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60000);
const sevenDaysAgo = new Date(2026, 9, 8, 12, 0);
const record = (userId, point, lastUpdated = now) => ({
  userId,
  userName: userId,
  userIconImageUrl: 'icon.png',
  point,
  lastUpdated,
});
// Firestore Web SDKの保存とクエリを、メモリ内のデータで再現する。
// 日時はTimestampで保存して返し、orderByに指定したフィールドを持たないドキュメントは結果に含めない。
function database(
  initial = {},
  { randomValues = (bytes) => bytes.fill(171) } = {},
) {
  const collections = new Map();
  const versions = new Map();
  // 送ったクエリと、返したドキュメントの件数
  const queries = [];
  // holdingの間に送ったクエリ。resolveで応答を返す。
  const held = [];
  const state = { offline: false, holding: false };
  let settings = {};
  const docsOf = (path) => {
    if (!collections.has(path)) collections.set(path, new Map());
    return collections.get(path);
  };
  const toStored = (value) =>
    value instanceof Date ? Timestamp.fromDate(value) : value;
  const touch = (key) => versions.set(key, (versions.get(key) ?? 0) + 1);
  const write = (ref, data, merge = false) => {
    const fields = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) {
        if (!settings.ignoreUndefinedProperties)
          throw new Error(`Unsupported field value: undefined (${key})`);
        continue;
      }
      fields[key] = toStored(value);
    }
    const docs = docsOf(ref.path);
    docs.set(ref.id, merge ? { ...docs.get(ref.id), ...fields } : fields);
    touch(`${ref.path}/${ref.id}`);
  };
  for (const [path, docs] of Object.entries(initial))
    for (const [id, data] of Object.entries(docs)) write({ path, id }, data);
  const online = () => {
    if (state.offline) throw new Error('unavailable');
  };
  const compare = (a, b) => {
    const rank = (value) =>
      typeof value === 'number' ? 0 : value instanceof Timestamp ? 1 : 2;
    return rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  };
  const run = (q) => {
    const orders = q.constraints.filter((c) => c.type === 'orderBy');
    const cursor = q.constraints.find((c) => c.type === 'startAt');
    const max = q.constraints.find((c) => c.type === 'limit');
    const order = (a, b, count = orders.length) => {
      for (const { field, direction } of orders.slice(0, count)) {
        const result = compare(a[field], b[field]);
        if (result) return direction === 'desc' ? -result : result;
      }
      return 0;
    };
    const idDirection = orders.at(-1)?.direction === 'desc' ? -1 : 1;
    let rows = [...docsOf(q.path)]
      .filter(([, data]) => orders.every(({ field }) => field in data))
      .sort(
        ([idA, a], [idB, b]) => order(a, b) || compare(idA, idB) * idDirection,
      );
    if (cursor) {
      const position = Object.fromEntries(
        cursor.values.map((value, i) => [orders[i].field, toStored(value)]),
      );
      rows = rows.filter(
        ([, data]) => order(data, position, cursor.values.length) >= 0,
      );
    }
    if (max) rows = rows.slice(0, max.value);
    queries.push({ path: q.path, size: rows.length });
    return {
      size: rows.length,
      empty: rows.length === 0,
      docs: rows.map(([id, data]) => ({ id, data: () => ({ ...data }) })),
    };
  };
  const getDocs = async (q) => {
    online();
    if (state.holding)
      await new Promise((resolve) => held.push({ path: q.path, resolve }));
    return run(q);
  };
  const sdk = {
    initializeFirestore: (app, options = {}) => {
      settings = options;
      return { app };
    },
    collection: (_db, path) => ({ path }),
    doc: (_db, path, id) => ({ path, id }),
    query: (ref, ...constraints) => ({ path: ref.path, constraints }),
    orderBy: (field, direction = 'asc') => ({
      type: 'orderBy',
      field,
      direction,
    }),
    startAt: (...values) => ({ type: 'startAt', values }),
    limit: (value) => ({ type: 'limit', value }),
    getDocs,
    getDocsFromServer: getDocs,
    getCountFromServer: async (q) => {
      online();
      const { size } = run(q);
      return { data: () => ({ count: size }) };
    },
    runTransaction: async (_db, update) => {
      online();
      // 読んだドキュメントが確定までに書き換えられていれば、Web SDKと同じくupdateを最初から実行し直す。
      for (let attempt = 0; attempt < 100; attempt++) {
        const read = new Map();
        const pending = [];
        const result = await update({
          get: async (ref) => {
            const key = `${ref.path}/${ref.id}`;
            read.set(key, versions.get(key) ?? 0);
            const data = docsOf(ref.path).get(ref.id);
            return {
              exists: () => data !== undefined,
              data: () => data && { ...data },
            };
          },
          set: (ref, data) => {
            pending.push([ref, data]);
          },
        });
        if (
          [...read].some(
            ([key, version]) => (versions.get(key) ?? 0) !== version,
          )
        )
          continue;
        for (const [ref, data] of pending) write(ref, data);
        return result;
      }
      throw new Error('aborted');
    },
    setDoc: async (ref, data, options) => {
      online();
      write(ref, data, options?.merge);
    },
    deleteDoc: async (ref) => {
      online();
      docsOf(ref.path).delete(ref.id);
      touch(`${ref.path}/${ref.id}`);
    },
  };
  const exported = load(
    'src/application/firebase/database.js',
    {
      'firebase/firestore': sdk,
      'firebase/app': { getApp: () => 'app' },
    },
    {
      Date: FixedDate,
      window: { Promise, crypto: { getRandomValues: randomValues } },
    },
  );
  exported.FireStoreExtention.init();
  return {
    ...exported,
    guests: exported.FireStoreExtention.guestStore,
    queries,
    held,
    state,
    // 保存されているドキュメントを、IDごとに返す。
    data: (path) => Object.fromEntries(docsOf(path)),
  };
}
const { FireStoreColumn } = database();
test('ゲスト番号は701、702と連番になり、件数集計や全件取得をしない', async () => {
  const d = database({ guests: { _sequence: { lastNumber: 700 } } });
  const first = await d.guests.createUserId();
  const second = await d.guests.createUserId();
  assert.equal(first.guestNumberWithPadding, '0000000701');
  assert.equal(second.guestNumberWithPadding, '0000000702');
  assert.equal(first.randomString, 'ab'.repeat(16));
  assert.deepEqual(d.queries, []);
  // カウンターだけを更新し、スコア用のドキュメントは作らない。
  assert.deepEqual(d.data('guests'), { _sequence: { lastNumber: 702 } });
});

test('初回は過去の20文字IDの最大番号を1件だけ取得して引き継ぐ', async () => {
  const d = database({
    guests: {
      '0000000300abcdefghij': record('0000000300abcdefghij', 5),
      '0000000700abcdefghij': record('0000000700abcdefghij', 3),
      '0000000500abcdefghij': record('0000000500abcdefghij', 8),
    },
  });
  assert.equal(
    (await d.guests.createUserId()).guestNumberWithPadding,
    '0000000701',
  );
  assert.equal(
    (await d.guests.createUserId()).guestNumberWithPadding,
    '0000000702',
  );
  assert.deepEqual(d.queries, [{ path: 'guests', size: 1 }]);
});
test('データがない場合は1から開始する', async () => {
  const d = database();
  assert.equal(
    (await d.guests.createUserId()).guestNumberWithPadding,
    '0000000001',
  );
});
test('保存済みのランダム番号があれば、その最大番号も再利用しない', async () => {
  const id = '0000932456' + 'ab'.repeat(16);
  const d = database({ guests: { [id]: record(id, 10) } });
  assert.equal(
    (await d.guests.createUserId()).guestNumberWithPadding,
    '0000932457',
  );
});
test('同時に20人が開始しても、番号が重複せず連番になる', async () => {
  const d = database({ guests: { _sequence: { lastNumber: 700 } } });
  const ids = await Promise.all(
    Array.from({ length: 20 }, () => d.guests.createUserId()),
  );
  assert.deepEqual(
    ids.map((id) => Number(id.guestNumberWithPadding)).sort((a, b) => a - b),
    Array.from({ length: 20 }, (_, i) => 701 + i),
  );
  assert.deepEqual(d.data('guests')._sequence, { lastNumber: 720 });
});
test('初回の同時開始でもカウンターを上書きせず連番を発行する', async () => {
  const id = '0000000700abcdefghij';
  const d = database({ guests: { [id]: record(id, 10) } });
  const ids = await Promise.all([
    d.guests.createUserId(),
    d.guests.createUserId(),
  ]);
  assert.deepEqual(
    ids.map((id) => Number(id.guestNumberWithPadding)).sort(),
    [701, 702],
  );
  assert.deepEqual(d.data('guests')._sequence, { lastNumber: 702 });
});
for (const value of [-1, 1.5, '700', NaN, 9999999999])
  test(`不正または上限のカウンター${value}は更新しない`, async () => {
    const d = database({ guests: { _sequence: { lastNumber: value } } });
    await assert.rejects(d.guests.createUserId());
    assert.deepEqual(d.data('guests'), { _sequence: { lastNumber: value } });
  });
test('10桁の最終番号でもIDは42文字を維持する', async () => {
  const d = database({ guests: { _sequence: { lastNumber: 9999999998 } } });
  const id = await d.guests.createUserId();
  assert.match(
    id.guestNumberWithPadding + id.randomString,
    /^9999999999[0-9a-f]{32}$/,
  );
});
test('安全な乱数が使えない場合はカウンターも進めない', async () => {
  const d = database(
    { guests: { _sequence: { lastNumber: 700 } } },
    {
      randomValues: () => {
        throw new Error('unavailable');
      },
    },
  );
  await assert.rejects(d.guests.createUserId());
  assert.deepEqual(d.data('guests'), { _sequence: { lastNumber: 700 } });
});
test('初回の既存IDが不正な場合は1からやり直さず失敗する', async () => {
  const d = database({ guests: { broken: record('broken', 10) } });
  await assert.rejects(d.guests.createUserId());
  assert.deepEqual(Object.keys(d.data('guests')), ['broken']);
});

// 開始画面。ランキングとゲスト番号の取得先を差し替え、ゲームの投球は始めない。
function screen({ guestStore, rankings = {}, loginUserName = null } = {}) {
  const { createVueInstance } = load(
    'src/application/vue/index.js',
    {
      '../vector/vector2': {},
      '../firebase/auth': {
        FirebaseAuthExtention: {
          auth: {
            getLoginUserName: () => loginUserName,
            getLoginUserId: () => null,
            signOutFromGoogle: async () => {},
          },
        },
      },
      '../firebase/database': {
        FireStoreExtention: {
          guestStore,
          getRankingHistory: async () => [],
          getRankingThisWeek: async () => [],
          ...rankings,
        },
        FireStoreColumn,
      },
      './process': {},
      './appConfig': { boardItems: [], guestImagePath: 'guest.png' },
      'regenerator-runtime/runtime.js': {},
    },
    {
      window: {
        document: { documentElement: { clientWidth: 390, clientHeight: 844 } },
        addEventListener: () => {},
      },
      Vue: function (options) {
        return options;
      },
      setTimeout: () => {},
    },
  );
  const options = createVueInstance();
  const app = { ...options.data, ...options.methods };
  return { app, mount: () => options.mounted.call(app) };
}
// Firestoreから取得したランキングの1件
const rankingRow = (point) => ({
  userId: `guest-${point}`,
  userName: `ゲスト${point}`,
  userIconImageUrl: 'guest.png',
  point,
  lastUpdated: Timestamp.fromDate(now),
});

test('画面は連番発行後に42文字のゲストIDを保持してゲームを始める', async () => {
  const d = database({ guests: { _sequence: { lastNumber: 700 } } });
  const { app } = screen({ guestStore: d.guests });
  await app.onClickGuestStart();
  assert.match(app.guestUserId, /^0000000701[0-9a-f]{32}$/);
  assert.equal(app.guestNumber, 701);
  assert.equal(app.isGameOpened, true);
  assert.deepEqual(Object.keys(d.data('guests')), ['_sequence']);
});

test('ID生成失敗は画面で通知し、再試行できる', async () => {
  let fail = true;
  const d = database(
    {},
    {
      randomValues: (bytes) => {
        if (fail) throw new Error('unavailable');
        return bytes.fill(0);
      },
    },
  );
  const { app } = screen({ guestStore: d.guests });
  await app.onClickGuestStart();
  assert.equal(app.isGameOpened, false);
  assert.equal(app.guestUserId, null);
  assert.match(app.startError, /開始できませんでした/);
  assert.equal(app.isStartingGame, false);
  fail = false;
  await app.onClickGuestStart();
  assert.equal(app.isGameOpened, true);
  assert.equal(app.startError, '');
});

test('歴代ランキングは得点の高い順に上位10件を返し、同点は先に記録した人を上位にする', async () => {
  const guests = { _sequence: { lastNumber: 12 } };
  for (const point of [30, 10, 9, 8, 7, 6, 5, 4, 3, 2])
    guests[`guest-${point}`] = record(`guest-${point}`, point);
  guests['later-20'] = record('later-20', 20, minutesAgo(1));
  guests['earlier-20'] = record('earlier-20', 20, minutesAgo(2));
  const d = database({ guests });
  const rows = await d.guests.getRankingHistory();
  assert.deepEqual(
    rows.map((row) => row.userId),
    [
      'guest-30',
      'earlier-20',
      'later-20',
      'guest-10',
      'guest-9',
      'guest-8',
      'guest-7',
      'guest-6',
      'guest-5',
      'guest-4',
    ],
  );
  assert.deepEqual(d.queries, [{ path: 'guests', size: 10 }]);
});
test('空の今週ランキングは追加クエリを送らない', async () => {
  const d = database();
  assert.equal((await d.guests.getRankingThisWeek()).length, 0);
  assert.equal(d.queries.length, 1);
});
test('今週は7日前から1回だけ取得し、仮登録を除く', async () => {
  const d = database({
    guests: {
      _sequence: { lastNumber: 4 },
      'within-7-days': record(
        'within-7-days',
        25,
        new Date(sevenDaysAgo.getTime() + 60000),
      ),
      'zero-point': record('zero-point', 0),
      provisional: record('provisional', -1),
      'before-7-days': record(
        'before-7-days',
        99,
        new Date(sevenDaysAgo.getTime() - 60000),
      ),
    },
  });
  assert.deepEqual(
    (await d.guests.getRankingThisWeek()).map((row) => row.userId).sort(),
    ['within-7-days', 'zero-point'],
  );
  assert.equal(d.queries.length, 1);
});
test('保存は同じIDの記録を上書きし、削除は指定IDの記録だけを消す', async () => {
  const d = database({ guests: { 'guest-2': record('guest-2', 5) } });
  // アイコンを渡さない記録も保存できる。
  await d.guests.upsertRanking({
    documentId: 'guest-1',
    userName: 'ゲスト1',
    point: 10,
  });
  await d.guests.upsertRanking({
    documentId: 'guest-1',
    userName: 'ゲスト1',
    point: 3,
  });
  assert.deepEqual(d.data('guests')['guest-1'], {
    userId: 'guest-1',
    userName: 'ゲスト1',
    point: 3,
    lastUpdated: Timestamp.fromDate(now),
  });
  await d.guests.deleteRanking('guest-2');
  assert.deepEqual(Object.keys(d.data('guests')), ['guest-1']);
});
test('読み取りに失敗したら、空のランキングにせず失敗を返す', async () => {
  for (const method of ['getRankingHistory', 'getRankingThisWeek']) {
    const d = database({ guests: { 'guest-1': record('guest-1', 5) } });
    d.state.offline = true;
    await assert.rejects(d.guests[method](), method);
  }
});
test('ゲストとログインユーザーの保存先を分離する', async () => {
  const d = database();
  await d.FireStoreExtention.guestStore.upsertRanking({
    documentId: 'guest-1',
    userName: 'ゲスト1',
    userIconImageUrl: 'guest.png',
    point: 1,
  });
  await d.FireStoreExtention.loginUserStore.upsertRanking({
    documentId: 'user-1',
    userName: '山田',
    userIconImageUrl: 'icon.png',
    point: 2,
  });
  assert.deepEqual(Object.keys(d.data('guests')), ['guest-1']);
  assert.deepEqual(Object.keys(d.data('loginUsers')), ['user-1']);
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
  const ready = a.handler.watchStateChanged();
  a.notify(null);
  await ready;
  a.sdk.signInWithPopup = async () => {
    throw new Error('cancelled');
  };
  await assert.rejects(a.handler.signInWithPopupToGoogle());
  assert.equal(a.handler.isLoggedIn(), false);
});

for (const method of ['getRankingHistory', 'getRankingThisWeek']) {
  test(`${method}は両コレクションへ同時に問い合わせ、得点・日時順の上位10件を返す`, async () => {
    const guests = {};
    for (let point = 0; point < 10; point++)
      guests[`guest-${point}`] = record(`guest-${point}`, point);
    const d = database({
      guests,
      loginUsers: {
        'user-9': record('user-9', 9, minutesAgo(60)),
        'user-20': record('user-20', 20, minutesAgo(60)),
      },
    });
    d.state.holding = true;
    const pending = d.FireStoreExtention[method]();
    assert.deepEqual(d.held.map((q) => q.path).sort(), [
      'guests',
      'loginUsers',
    ]);
    for (const q of d.held) q.resolve();
    assert.deepEqual(
      [...(await pending)].map((row) => row.userId),
      [
        'user-20',
        'user-9',
        'guest-9',
        'guest-8',
        'guest-7',
        'guest-6',
        'guest-5',
        'guest-4',
        'guest-3',
        'guest-2',
      ],
    );
  });
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('番号と週間ランキングが取得中でも歴代を表示し、番号が届けば開始画面に保持する', async () => {
  let finishHistory, finishWeek, finishGuest;
  const { app, mount } = screen({
    rankings: {
      getRankingHistory: () =>
        new Promise((r) => {
          finishHistory = r;
        }),
      getRankingThisWeek: () =>
        new Promise((r) => {
          finishWeek = r;
        }),
    },
    guestStore: {
      createUserId: () =>
        new Promise((r) => {
          finishGuest = r;
        }),
    },
  });
  mount();
  assert.equal(app.shouldShowInitImage, false);
  assert.equal(app.guestUserId, null);
  assert.equal(app.isPreparingGuest, true);
  finishGuest({
    guestNumberWithPadding: '0000000701',
    randomString: 'ab'.repeat(16),
  });
  await flush();
  assert.equal(app.guestNumber, 701);
  assert.equal(app.isPreparingGuest, false);
  assert.equal(typeof finishWeek, 'function');
  finishHistory([rankingRow(21)]);
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
  const { app } = screen({
    rankings: {
      getRankingHistory: async () => [rankingRow(12)],
      getRankingThisWeek: async () => {
        if (fail) throw new Error('offline');
        return [rankingRow(7)];
      },
    },
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
  const { app } = screen({
    rankings: {
      getRankingHistory: () => new Promise((r) => pending.push(r)),
    },
  });
  const old = app.initializeTopMenuData();
  const current = app.initializeTopMenuData();
  pending[1]([rankingRow(20)]);
  await current;
  pending[0]([rankingRow(1)]);
  await old;
  assert.equal(app.rankings.history.dataList[0].point, 20);
});

test('ゲスト開始を連打してもID発行は1回、発行後に開始する', async () => {
  let count = 0,
    finish;
  const { app } = screen({
    guestStore: {
      createUserId: () => {
        count++;
        return new Promise((r) => {
          finish = r;
        });
      },
    },
  });
  const first = app.onClickGuestStart();
  await flush();
  await app.onClickGuestStart();
  assert.equal(count, 1);
  assert.equal(app.isGameOpened, false);
  finish({
    guestNumberWithPadding: '0000000007',
    randomString: 'ab'.repeat(16),
  });
  await first;
  assert.equal(app.isGameOpened, true);
  assert.equal(app.guestNumber, 7);
  assert.equal(app.isStartingGame, false);
});

test('発番通信に失敗した場合はランダム番号で開始せず、再試行できる', async () => {
  const d = database({ guests: { _sequence: { lastNumber: 700 } } });
  const { app } = screen({ guestStore: d.guests });
  d.state.offline = true;
  await app.onClickGuestStart();
  assert.equal(app.isGameOpened, false);
  assert.equal(app.guestUserId, null);
  assert.equal(app.guestNumber, null);
  assert.match(app.startError, /開始できませんでした/);
  assert.deepEqual(d.data('guests'), { _sequence: { lastNumber: 700 } });
  d.state.offline = false;
  await app.onClickGuestStart();
  assert.equal(app.isGameOpened, true);
  assert.equal(app.guestNumber, 701);
  assert.equal(app.startError, '');
});
test('同じゲストで再度開始する場合は番号を再発行しない', async () => {
  const d = database({ guests: { _sequence: { lastNumber: 700 } } });
  const { app } = screen({ guestStore: d.guests });
  await app.onClickGuestStart();
  const first = app.guestUserId;
  await app.onClickGuestStart();
  assert.equal(app.guestUserId, first);
  assert.deepEqual(d.data('guests'), { _sequence: { lastNumber: 701 } });
});

test('開始画面の発番中に開始を押しても番号を二重発行しない', async () => {
  let calls = 0,
    finish;
  const { app, mount } = screen({
    guestStore: {
      createUserId: () => {
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
    },
  });
  mount();
  const start = app.onClickGuestStart();
  await flush();
  assert.equal(calls, 1);
  assert.equal(app.isGameOpened, false);
  finish({
    guestNumberWithPadding: '0000000701',
    randomString: 'ab'.repeat(16),
  });
  await start;
  assert.equal(app.guestNumber, 701);
  assert.equal(app.isGameOpened, true);
  await app.onClickGuestStart();
  assert.equal(calls, 1);
});

test('画面表示時の発番に失敗したら画面に表示し、「ゲストとして開始」で再試行できる', async () => {
  let fail = true;
  const { app, mount } = screen({
    guestStore: {
      createUserId: async () => {
        if (fail) throw new Error('offline');
        return {
          guestNumberWithPadding: '0000000701',
          randomString: 'ab'.repeat(16),
        };
      },
    },
  });
  mount();
  await flush();
  assert.match(app.startError, /ゲスト番号を取得できませんでした/);
  assert.equal(app.isPreparingGuest, false);
  assert.equal(app.guestUserId, null);
  fail = false;
  await app.onClickGuestStart();
  assert.equal(app.guestNumber, 701);
  assert.equal(app.isGameOpened, true);
});

test('ログイン済みの開始画面ではゲスト番号を発行しない', async () => {
  let calls = 0;
  const { app, mount } = screen({
    guestStore: {
      createUserId: async () => {
        calls++;
      },
    },
    loginUserName: '山田',
  });
  mount();
  await flush();
  assert.equal(app.loginUserName, '山田');
  assert.equal(calls, 0);
  assert.equal(app.isPreparingGuest, false);
});
