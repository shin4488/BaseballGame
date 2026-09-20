const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const babel = require("@babel/core");
const cache = new Map();
function load(file, dependencies = {}, globals = {}) {
  if (!cache.has(file))
    cache.set(
      file,
      babel.transformFileSync(file, {
        presets: ["@babel/preset-env"],
        babelrc: false,
        configFile: false,
      }).code
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
const vector = load("src/application/vector/vector2.js");
const processModule = load("src/application/vue/process.js", {
  "../vector/vector2": vector,
});
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
function fixture(
  boards = [{ left: 100, point: 4, out: 0 }],
  { width = 800, height = 600 } = {}
) {
  let now = 0,
    nextId = 0;
  const timers = new Map();
  const schedule = (fn, delay, repeat = false) => {
    const id = ++nextId;
    timers.set(id, { fn, at: now + delay, delay, repeat });
    return id;
  };
  const f = {
    center: { x: 170, y: 300 },
    bat: rect(100, 300, 150, 20),
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
    getElementById: (id) => ({
      getBoundingClientRect: () =>
        id === "bat" ? f.bat : rect(f.center.x - 20, f.center.y - 20, 40, 40),
    }),
  };
  const mod = load(
    "src/application/vue/index.js",
    {
      "../vector/vector2": vector,
      "../firebase/auth": {},
      "../firebase/database": {},
      "./process": { ...processModule, getRandomNumber: () => 21 },
      "./appConfig": { boardItems: [] },
      "regenerator-runtime/runtime.js": {},
    },
    {
      window: { document: doc, Promise },
      Date: { now: () => now },
      Vue: function (o) {
        return o;
      },
      setInterval: (fn, delay) => schedule(fn, delay, true),
      clearInterval: (id) => timers.delete(id),
      setTimeout: (fn, delay) => schedule(fn, delay),
      clearTimeout: (id) => timers.delete(id),
    }
  );
  const options = mod.createVueInstance();
  f.app = { ...options.data };
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
  f.timers = timers;
  return f;
}
async function hitPath(centers, boards, initialOut = 0) {
  const f = fixture(boards);
  f.app.outCount = initialOut;
  const pending = f.app.throwBall();
  await f.advance(30); // バットで打ち返す。
  f.bat = rect(600, 500, 20, 100);
  for (const center of centers) {
    f.center = center;
    await f.advance(30);
  }
  assert.equal(f.timers.size, 0, "1球が終了し、移動タイマーが残らない");
  await pending;
  return f.app;
}
test("満塁ホームランの中央を通る高速打球をアウトにしない", async () => {
  const app = await hitPath([83, 62, 41, 20].map((y) => ({ x: 170, y })));
  assert.equal(app.point, 4);
  assert.equal(app.outCount, 0);
});
test("フレーム間に的を完全に通過しても得点する", async () => {
  const app = await hitPath([
    { x: 170, y: 90 },
    { x: 170, y: 0 },
  ]);
  assert.equal(app.point, 4);
  assert.equal(app.outCount, 0);
});
for (const point of [1, 2, 3, 4])
  test(`${point}点の的への命中でその点だけ加算する`, async () => {
    const app = await hitPath(
      [
        { x: 170, y: 50 },
        { x: 170, y: 30 },
        { x: 170, y: 0 },
      ],
      [{ left: 100, point, out: 0 }]
    );
    assert.equal(app.point, point);
    assert.equal(app.outCount, 0);
  });
for (const out of [1, 2, 3])
  test(`${out}アウトの的は得点せず、アウト数を3で止める`, async () => {
    const app = await hitPath(
      [
        { x: 170, y: 50 },
        { x: 170, y: 30 },
        { x: 170, y: 0 },
      ],
      [{ left: 100, point: 0, out }],
      1
    );
    assert.equal(app.point, 0);
    assert.equal(app.outCount, Math.min(3, 1 + out));
  });
test("的の隙間を抜ける打球はアウト", async () => {
  const app = await hitPath([
    { x: 350, y: 100 },
    { x: 350, y: 40 },
    { x: 350, y: 0 },
  ]);
  assert.equal(app.point, 0);
  assert.equal(app.outCount, 1);
});
test("隣接した的ではDOMの順序でなく先に触れた的を採用する", async () => {
  const app = await hitPath(
    [
      { x: 330, y: 90 },
      { x: 180, y: 0 },
    ],
    [
      { left: 100, point: 0, out: 1 },
      { left: 260, point: 4, out: 0 },
    ]
  );
  assert.equal(app.point, 4);
  assert.equal(app.outCount, 0);
});
test("投球が長引いても重複せず、結果表示時間を確保する", async () => {
  const f = fixture();
  let pitches = 0,
    finish;
  f.app.throwBall = () => {
    pitches++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  f.app.clearThrowingBall = () => {};
  f.app.executeBaseballGame();
  await f.advance(4000);
  assert.equal(pitches, 1);
  await f.advance(8000);
  assert.equal(pitches, 1);
  finish();
  await f.advance(0);
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await f.advance(1499);
  assert.equal(pitches, 1);
  await f.advance(1);
  assert.equal(pitches, 2);
});
test("開始の重複呼び出しで複数のゲームを起動しない", async () => {
  const f = fixture();
  let pitches = 0;
  f.app.throwBall = () => {
    pitches++;
    return new Promise(() => {});
  };
  f.app.executeBaseballGame();
  f.app.executeBaseballGame();
  await f.advance(4000);
  assert.equal(pitches, 1);
});
test("3アウト後に追加投球せず結果を表示し、リトライは0から1試合だけ開始する", async () => {
  const f = fixture();
  let pitches = 0;
  f.app.throwBall = async () => {
    pitches++;
    f.app.outCount = 3;
    f.app.point = 4;
  };
  f.app.clearThrowingBall = () => {};
  f.app.executeBaseballGame();
  await f.advance(10000);
  assert.equal(pitches, 1);
  assert.equal(f.app.shouldShowResult, true);
  assert.equal(f.app.isGameOpened, false);
  assert.equal(f.timers.size, 0);
  f.app.onClickRetryButton();
  assert.equal(f.app.point, 0);
  assert.equal(f.app.outCount, 0);
  assert.equal(f.app.strikeCount, 0);
  await f.advance(4000);
  assert.equal(pitches, 2);
});

test("速度11〜30pxと各開始位置の410通りで、的の中央への命中を取りこぼさない", async () => {
  let cases = 0;
  for (let speed = 11; speed <= 30; speed++)
    for (let phase = 0; phase < speed; phase++) {
      const centers = [];
      for (let y = 70 + phase; y >= -30; y -= speed)
        centers.push({ x: 170, y });
      const app = await hitPath(centers);
      assert.equal(app.point, 4, `speed=${speed}, phase=${phase}`);
      assert.equal(app.outCount, 0);
      cases++;
    }
  assert.equal(cases, 410);
});
for (const [name, previous, current, expected] of [
  ["下面の中央に最初に触れる", { x: 170, y: 90 }, { x: 170, y: 0 }, 1 / 3],
  ["端点への接線も命中する", { x: 80, y: 90 }, { x: 80, y: 0 }, 5 / 9],
  ["端点の半径より外は命中しない", { x: 79, y: 90 }, { x: 79, y: 0 }, null],
  ["投球方向では命中しない", { x: 170, y: 0 }, { x: 170, y: 90 }, null],
  ["静止したボールを再加点しない", { x: 170, y: 40 }, { x: 170, y: 40 }, null],
])
  test(name, () => {
    const actual = processModule.getBoardHitTime(previous, current, 20, {
      left: 100,
      right: 250,
      bottom: 40,
    });
    if (expected === null) assert.equal(actual, null);
    else assert.ok(Math.abs(actual - expected) < 1e-10);
  });
for (const strikes of [0, 1, 2])
  test(`空振りはストライク${strikes}から規定どおり増える`, async () => {
    const f = fixture();
    f.bat = rect(600, 500, 20, 100);
    f.app.strikeCount = strikes;
    const pending = f.app.throwBall();
    f.center = { x: 170, y: 550 };
    await f.advance(30);
    await pending;
    assert.equal(f.app.strikeCount, strikes === 2 ? 0 : strikes + 1);
    assert.equal(f.app.outCount, strikes === 2 ? 1 : 0);
    assert.equal(f.app.point, 0);
  });
test("2ストライクでのファールはアウトにしない", async () => {
  const f = fixture();
  f.app.strikeCount = 2;
  const pending = f.app.throwBall();
  await f.advance(30);
  f.center = { x: 5, y: 300 };
  await f.advance(30);
  await pending;
  assert.equal(f.app.strikeCount, 2);
  assert.equal(f.app.outCount, 0);
  assert.equal(f.app.message, "ファール");
});
test("短い投球では従来の4秒間隔を維持する", async () => {
  const f = fixture();
  let pitches = 0;
  f.app.throwBall = async () => {
    pitches++;
  };
  f.app.clearThrowingBall = () => {};
  f.app.executeBaseballGame();
  await f.advance(4000);
  assert.equal(pitches, 1);
  await f.advance(3999);
  assert.equal(pitches, 1);
  await f.advance(1);
  assert.equal(pitches, 2);
});
