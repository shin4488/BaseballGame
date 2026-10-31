const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const babel = require('@babel/core');
const cache = new Map();
function load(file, dependencies = {}, globals = {}) {
  if (!cache.has(file))
    cache.set(
      file,
      babel.transformFileSync(file, {
        presets: [['@babel/preset-env', { modules: 'commonjs' }]],
        babelrc: false,
        configFile: false,
      }).code,
    );
  const exports = {};
  vm.runInNewContext(cache.get(file), {
    exports,
    ...globals,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  });
  return exports;
}
const vector = load('src/application/vector/vector2.js');
const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
});
// 既定のMath.randomの値。投球の速さは10〜30pxのうち21pxになる。
const defaultRandom = 0.55;
function fixture(
  boards = [{ left: 100, point: 4, out: 0 }],
  { width = 800, height = 600, random = defaultRandom } = {},
) {
  let now = 0,
    nextId = 0;
  const timers = new Map();
  const schedule = (fn, delay, repeat = false) => {
    const id = ++nextId;
    timers.set(id, { fn, at: now + delay, delay, repeat });
    return id;
  };
  // batは、回転前のバットの要素の左上（offsetLeft・offsetTop）。
  const f = {
    center: { x: 170, y: 300 },
    bat: { left: 88, top: 300 },
    boards,
  };
  const doc = {
    documentElement: { clientWidth: width, clientHeight: height },
    getElementsByClassName: () =>
      f.boards.map((b) => ({
        dataset: {
          point: String(b.point),
          out: String(b.out),
          message: `的${b.point}/${b.out}`,
        },
        getBoundingClientRect: () => rect(b.left, 0, 150, 40),
      })),
    getElementById: (id) =>
      id === 'bat'
        ? { offsetLeft: f.bat.left, offsetTop: f.bat.top }
        : {
            getBoundingClientRect: () =>
              rect(f.center.x - 20, f.center.y - 20, 40, 40),
          },
  };
  const math = Object.create(Math, { random: { value: () => random } });
  const mod = load(
    'src/application/vue/index.js',
    {
      '../vector/vector2': vector,
      '../firebase/auth': {
        FirebaseAuthExtention: {
          auth: { isLoggedIn: () => true, getLoginUserName: () => '山田' },
        },
      },
      '../firebase/database': {},
      './process': load(
        'src/application/vue/process.js',
        { '../vector/vector2': vector },
        { Math: math },
      ),
      './appConfig': { boardItems: [] },
      'regenerator-runtime/runtime.js': {},
    },
    {
      window: { document: doc, Promise },
      Math: math,
      Date: { now: () => now },
      Vue: function (o) {
        return o;
      },
      setInterval: (fn, delay) => schedule(fn, delay, true),
      clearInterval: (id) => timers.delete(id),
      setTimeout: (fn, delay) => schedule(fn, delay),
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const options = mod.createVueInstance();
  // 既定では、バットを水平（-90度）に止め、グリップ側の端(108, 300)から右へ伸びる上のラインに、ボールの中心(170, 300)を重ねる。
  f.app = { ...options.data, batRotateDegree: -90 };
  for (const [key, getter] of Object.entries(options.computed))
    Object.defineProperty(f.app, key, { get: () => getter.call(f.app) });
  for (const [key, method] of Object.entries(options.methods))
    f.app[key] = method.bind(f.app);
  f.advance = async (milliseconds) => {
    const end = now + milliseconds;
    while (true) {
      const item = [...timers]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!item) break;
      const [id, t] = item;
      now = t.at;
      if (t.repeat) t.at += t.delay;
      else timers.delete(id);
      t.fn();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    }
    now = end;
  };
  // ログイン済みのプレイヤーとして開始し、4秒後に1球目を投げ始めるまで進める。
  f.startFirstPitch = async () => {
    f.app.onClickLogin();
    await f.advance(4000);
  };
  return f;
}
// バットに触れず、下端がストライクの判定線（画面の下端から60px上）を越える位置
const strikeZone = { x: 170, y: 550 };
// 的・画面の端・ストライクの判定線に届かず、投球が続く位置
const inFlight = { x: 170, y: 200 };
// 投げ始めた直後の判定で水平のバットに当てて打ち返し、その後の判定ごとにボールの中心をcentersの順に動かす。
async function hitAndMove(f, centers) {
  f.center = { x: 170, y: 300 };
  await f.advance(30);
  for (const center of centers) {
    f.center = center;
    await f.advance(30);
  }
}
// 開始してから4秒ごとに投げる球を、pitchesの打球の軌道で順に打ち返し、次の球を投げ始めるまで進める。
// 1球の結果が決まった後もボールが判定され続けると、上端にあるボールがアウトになり、得点・アウト数が変わる。
async function play(pitches, boards) {
  const f = fixture(boards);
  await f.startFirstPitch();
  for (const centers of pitches) {
    await hitAndMove(f, centers);
    await f.advance(4000 - 30 * (centers.length + 1));
  }
  return f.app;
}
const throughBoardCenter = [
  { x: 170, y: 50 },
  { x: 170, y: 30 },
  { x: 170, y: 0 },
];
const throughGap = [
  { x: 350, y: 100 },
  { x: 350, y: 40 },
  { x: 350, y: 0 },
];
test('満塁ホームランの中央を通る高速打球をアウトにしない', async () => {
  const app = await play([[83, 62, 41, 20].map((y) => ({ x: 170, y }))]);
  assert.equal(app.point, 4);
  assert.equal(app.outCount, 0);
});
test('フレーム間に的を完全に通過しても得点する', async () => {
  const app = await play([
    [
      { x: 170, y: 90 },
      { x: 170, y: 0 },
    ],
  ]);
  assert.equal(app.point, 4);
  assert.equal(app.outCount, 0);
});
for (const point of [1, 2, 3, 4])
  test(`${point}点の的への命中でその点だけ加算する`, async () => {
    const app = await play(
      [throughBoardCenter],
      [{ left: 100, point, out: 0 }],
    );
    assert.equal(app.point, point);
    assert.equal(app.outCount, 0);
  });
for (const out of [1, 2, 3])
  test(`1アウトから${out}アウトの的に当てると得点せず、アウト数を3で止める`, async () => {
    const app = await play(
      [throughGap, throughBoardCenter],
      [{ left: 100, point: 0, out }],
    );
    assert.equal(app.point, 0);
    assert.equal(app.outCount, Math.min(3, 1 + out));
  });
test('的の隙間を抜ける打球はアウト', async () => {
  const app = await play([throughGap]);
  assert.equal(app.point, 0);
  assert.equal(app.outCount, 1);
});
// 的は左端100px・下端40px。半径20pxのボールは、中心が左端から20px左を通ると的の左下の角に触れる。
for (const [name, x, point, out] of [
  ['的の左端から20px左を中心が通る打球は、的の角に触れて得点する', 80, 4, 0],
  ['的の左端から21px左を中心が通る打球は、的に触れずアウト', 79, 0, 1],
])
  test(name, async () => {
    const app = await play([
      [
        { x, y: 90 },
        { x, y: 0 },
      ],
    ]);
    assert.equal(app.point, point);
    assert.equal(app.outCount, out);
  });
test('画面の左端の的に触れた打球は、同じ判定の間に画面の端へ出てもファールにしない', async () => {
  // ボールの上端は的の下端に触れるが、中心は的の下端まで届かないうちに、ボールの左端が画面の左端を越える。
  const app = await play(
    [
      [
        { x: 40, y: 90 },
        { x: 15, y: 55 },
      ],
    ],
    [{ left: 0, point: 4, out: 0 }],
  );
  assert.equal(app.point, 4);
  assert.equal(app.strikeCount, 0);
});
test('投げたボールは的に重なっても得点せず、そのまま投球を続ける', async () => {
  const f = fixture();
  f.bat = { left: 600, top: 500 };
  // 的の下端にかかる位置から、下へ向かって投げる。
  f.center = { x: 170, y: 25 };
  await f.startFirstPitch();
  await f.advance(30);
  f.center = { x: 170, y: 50 };
  await f.advance(30);
  assert.equal(f.app.point, 0);
  assert.equal(f.app.outCount, 0);
  f.center = strikeZone;
  await f.advance(30);
  assert.equal(f.app.strikeCount, 1);
  assert.equal(f.app.point, 0);
});
test('隣接した的ではDOMの順序でなく先に触れた的を採用する', async () => {
  const app = await play(
    [
      [
        { x: 330, y: 90 },
        { x: 180, y: 0 },
      ],
    ],
    [
      { left: 100, point: 0, out: 1 },
      { left: 260, point: 4, out: 0 },
    ],
  );
  assert.equal(app.point, 4);
  assert.equal(app.outCount, 0);
});
test('投球が長引いても重複せず、結果表示時間を確保する', async () => {
  const f = fixture();
  f.bat = { left: 600, top: 500 };
  f.center = inFlight;
  await f.startFirstPitch();
  await f.advance(9000);
  assert.equal(f.app.strikeCount, 0, '9秒間、1球目の投球が続く');
  f.center = strikeZone;
  await f.advance(30);
  assert.equal(f.app.strikeCount, 1, '投げている球は1球だけ');
  // 2球目は、1球目の結果から1500ms後に投げ始め、その30ms後の判定でストライクになる。
  await f.advance(1529);
  assert.equal(f.app.strikeCount, 1);
  await f.advance(1);
  assert.equal(f.app.strikeCount, 2);
});
test('開始の重複呼び出しで複数のゲームを起動しない', async () => {
  const f = fixture();
  f.center = strikeZone;
  f.app.onClickLogin();
  f.app.onClickLogin();
  await f.advance(4030);
  assert.equal(f.app.strikeCount, 1, '1球だけを判定する');
});
test('3アウト後に追加投球せず結果を表示し、リトライは0から1試合だけ開始する', async () => {
  const f = fixture([{ left: 100, point: 4, out: 0 }]);
  await f.startFirstPitch();
  await hitAndMove(f, [{ x: 170, y: 0 }]);
  // 的は投げ始めるときの表示から選ぶため、2球目を投げ始める前に入れ替える。
  f.boards = [{ left: 100, point: 0, out: 3 }];
  await f.advance(4000 - 60);
  await hitAndMove(f, [{ x: 170, y: 0 }]);
  assert.equal(f.app.outCount, 3);
  // 追加の投球があれば、上端にあるボールがアウトになる。
  await f.advance(10000);
  assert.equal(f.app.point, 4);
  assert.equal(f.app.outCount, 3);
  assert.equal(f.app.message, 'ゲームセット');
  assert.equal(f.app.shouldShowResult, true);
  assert.equal(f.app.isGameOpened, false);
  f.app.onClickRetryButton();
  assert.equal(f.app.point, 0);
  assert.equal(f.app.outCount, 0);
  assert.equal(f.app.strikeCount, 0);
  f.center = strikeZone;
  await f.advance(4030);
  assert.equal(f.app.strikeCount, 1, '1試合分の1球だけを判定する');
});

for (const [random, speed, xSpeed] of [
  [0, 10, -30],
  [0.999999, 30, 30],
])
  test(`乱数が${random}のとき、投球は${speed}px、打球の横方向は${xSpeed}pxずつ動く`, async () => {
    const f = fixture(undefined, { random });
    await f.startFirstPitch();
    await f.advance(30); // バットで打ち返す。
    f.bat = { left: 600, top: 500 };
    await f.advance(30);
    assert.equal(f.app.yBallPosition, -speed);
    assert.equal(f.app.xBallPosition, xSpeed);
  });
test('速度10〜30pxと各開始位置の420通りで、的の中央への命中を取りこぼさない', async () => {
  let cases = 0;
  for (let speed = 10; speed <= 30; speed++)
    for (let phase = 0; phase < speed; phase++) {
      const centers = [];
      for (let y = 70 + phase; y >= -30; y -= speed)
        centers.push({ x: 170, y });
      const app = await play([centers]);
      assert.equal(app.point, 4, `speed=${speed}, phase=${phase}`);
      assert.equal(app.outCount, 0);
      cases++;
    }
  assert.equal(cases, 420);
});
for (const [strikes, message, expectedStrikes, expectedOuts] of [
  [0, 'ストライク', 1, 0],
  [1, 'ストライク', 2, 0],
  [2, '三振', 0, 1],
])
  test(`${strikes}ストライクからの見逃しは「${message}」で、ストライク${expectedStrikes}・アウト${expectedOuts}になる`, async () => {
    const f = fixture();
    f.center = strikeZone;
    f.app.onClickLogin();
    // 4秒ごとに投げる球を、strikes球続けて見逃し、次の球を投げ始めるまで進める。
    await f.advance(4000 * (strikes + 1));
    assert.equal(f.app.strikeCount, strikes);
    await f.advance(30);
    assert.equal(f.app.message, message);
    assert.equal(f.app.strikeCount, expectedStrikes);
    assert.equal(f.app.outCount, expectedOuts);
    assert.equal(f.app.point, 0);
  });
// グリップ側の端が(108, 420)のバット。ゲームと同じく、ボールの中心がグリップの100px下を過ぎるとストライクになる。
const batAtGameHeight = { left: 88, top: 420 };
test('判定と判定の間にバットがボールを通り過ぎても、打ち返す', async () => {
  // 1球目を投げ始めてから60msの判定は-30度でグリップの55px下、90msの判定は-60度で85px下。どちらの時点もバットに触れていない。
  const f = fixture();
  f.bat = batAtGameHeight;
  f.app.batRotateDegree = 0;
  f.center = { x: 170, y: 445 };
  await f.startFirstPitch();
  await f.advance(30);
  await f.advance(5);
  f.app.onClickHit();
  f.center = { x: 170, y: 475 };
  await f.advance(25);
  assert.equal(f.app.batRotateDegree, -30);
  assert.equal(f.app.yBallPosition, 42, '60msの時点では打ち返していない');
  f.center = { x: 170, y: 505 };
  await f.advance(30);
  assert.equal(f.app.batRotateDegree, -60);
  f.bat = { left: 600, top: 500 };
  f.center = { x: 170, y: 300 };
  await f.advance(30);
  assert.equal(f.app.yBallPosition, 21, '跳ね返って上へ動く');
  f.center = { x: 170, y: 0 };
  await f.advance(30);
  assert.equal(f.app.point, 4);
  assert.equal(f.app.strikeCount, 0);
});
test('前回の判定は-80度、今回は0度に戻っていても、間に描いた-90度のバットに触れれば打ち返す', async () => {
  // グリップの62px右のボールは、-80度のバットにはグリップより9.4px以上下で、水平のバットにはグリップの20px上から触れる。
  // 1球目を投げ始めてから120msの判定ではグリップの25px上、150msの判定では12px上にある。
  const f = fixture();
  f.app.batRotateDegree = 0;
  f.center = { x: 170, y: 100 };
  await f.startFirstPitch();
  await f.advance(30);
  await f.advance(15);
  f.app.onClickHit();
  f.center = { x: 170, y: 150 };
  await f.advance(15);
  f.center = { x: 170, y: 200 };
  await f.advance(30);
  f.center = { x: 170, y: 275 };
  await f.advance(30);
  assert.equal(f.app.batRotateDegree, -80);
  assert.equal(f.app.yBallPosition, 84, '120msの時点では打ち返していない');
  f.center = { x: 170, y: 288 };
  await f.advance(30);
  assert.equal(f.app.batRotateDegree, 0);
  f.bat = { left: 600, top: 500 };
  f.center = { x: 170, y: 200 };
  await f.advance(30);
  assert.equal(f.app.yBallPosition, 63, '跳ね返って上へ動く');
  f.center = { x: 170, y: 0 };
  await f.advance(30);
  assert.equal(f.app.point, 4);
});
test('水平のバットの上のラインから40pxより下を通るボールは打ち返さず、ストライク', async () => {
  const f = fixture();
  f.bat = batAtGameHeight;
  f.center = { x: 170, y: 461 };
  await f.startFirstPitch();
  await f.advance(30);
  f.center = { x: 170, y: 521 };
  await f.advance(30);
  assert.equal(f.app.message, 'ストライク');
  assert.equal(f.app.strikeCount, 1);
});
test('2ストライクでのファールはアウトにしない', async () => {
  const f = fixture();
  f.center = strikeZone;
  f.app.onClickLogin();
  // 2球続けて見逃し、3球目を投げ始めるまで進める。
  await f.advance(12000);
  assert.equal(f.app.strikeCount, 2);
  await hitAndMove(f, [{ x: 5, y: 300 }]);
  assert.equal(f.app.strikeCount, 2);
  assert.equal(f.app.outCount, 0);
  assert.equal(f.app.message, 'ファール');
});
test('短い投球では4秒間隔で次の球を投げる', async () => {
  const f = fixture();
  f.center = strikeZone;
  f.app.onClickLogin();
  // 開始から4秒後に1球目を投げ始め、その30ms後の判定でストライクになる。
  await f.advance(4029);
  assert.equal(f.app.strikeCount, 0);
  await f.advance(1);
  assert.equal(f.app.strikeCount, 1);
  await f.advance(3999);
  assert.equal(f.app.strikeCount, 1);
  await f.advance(1);
  assert.equal(f.app.strikeCount, 2);
});
