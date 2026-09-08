const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");

function load(file) {
  const code = babel.transformFileSync(file, {
    presets: ["@babel/preset-env"],
    babelrc: false,
    configFile: false,
  }).code;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    Math,
    require: (name) => {
      if (name === "../vector/vector2")
        return load("src/application/vector/vector2.js");
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const { getResultMessage, getRandomNumber, isHitCircleToLine } = load(
  "src/application/vue/process.js"
);
const Vector2 = load("src/application/vector/vector2.js").default;

for (const [point, message] of [
  [0, "あきらめないで！"],
  [1, "調子が出てきた！"],
  [9, "調子が出てきた！"],
  [10, "やったね！"],
  [19, "やったね！"],
  [20, "うまい！"],
  [49, "うまい！"],
  [50, "プロ野球選手も夢じゃない！"],
]) {
  test(`得点${point}の結果メッセージ`, () =>
    assert.equal(getResultMessage(point), `${message} ${point} 得点`));
}
test("乱数の両端を含み、同じ上下限にも対応する", (t) => {
  const random = Math.random;
  t.after(() => {
    Math.random = random;
  });
  Math.random = () => 0;
  assert.equal(getRandomNumber(10, 3), 3);
  Math.random = () => 0.999999;
  assert.equal(getRandomNumber(10, 3), 10);
  assert.equal(getRandomNumber(3, 3), 3);
});
test("水平バットの中央で当たり、十分離れたボールは外れる", () => {
  assert.equal(
    isHitCircleToLine(
      new Vector2(0, 0),
      new Vector2(10, 0),
      new Vector2(5, 0),
      1,
      -1
    ),
    true
  );
  assert.equal(
    isHitCircleToLine(
      new Vector2(0, 0),
      new Vector2(10, 0),
      new Vector2(30, 0),
      1,
      -1
    ),
    false
  );
});
test("ビルド後にもゲームの入口・画像・スタイルが配信される", () => {
  for (const file of [
    "index.html",
    "main.js",
    "style/index.css",
    "image/ball.png",
    "image/bat.png",
    "image/guest.png",
  ]) {
    assert.ok(fs.statSync(`publish/${file}`).size > 0, file);
  }
  const html = fs.readFileSync("publish/index.html", "utf8");
  assert.match(html, /main\.js/);
  assert.match(html, /style\/index\.css/);
});
