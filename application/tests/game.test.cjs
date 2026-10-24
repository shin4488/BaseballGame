const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function load(file) {
  const code = babel.transformFileSync(file, {
    presets: [['@babel/preset-env', { modules: 'commonjs' }]],
    babelrc: false,
    configFile: false,
  }).code;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    Math,
    require: (name) => {
      if (name === '../vector/vector2')
        return load('src/application/vector/vector2.js');
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return exports;
}
const {
  getResultMessage,
  getRandomNumber,
  isBallTouchingBat,
  isBallHitDuringSwing,
} = load('src/application/vue/process.js');
const Vector2 = load('src/application/vector/vector2.js').default;

for (const [point, message] of [
  [0, 'あきらめないで！'],
  [1, '調子が出てきた！'],
  [9, '調子が出てきた！'],
  [10, 'やったね！'],
  [19, 'やったね！'],
  [20, 'うまい！'],
  [49, 'うまい！'],
  [50, 'プロ野球選手も夢じゃない！'],
]) {
  test(`得点${point}の結果メッセージ`, () =>
    assert.equal(getResultMessage(point), `${message} ${point} 得点`));
}
test('乱数の両端を含み、同じ上下限にも対応する', (t) => {
  const random = Math.random;
  t.after(() => {
    Math.random = random;
  });
  Math.random = () => 0;
  assert.equal(getRandomNumber(3, 10), 3);
  assert.equal(getRandomNumber(-30, 30), -30);
  Math.random = () => 0.999999;
  assert.equal(getRandomNumber(3, 10), 10);
  assert.equal(getRandomNumber(-30, 30), 30);
  assert.equal(getRandomNumber(3, 3), 3);
});
test('ベクトルの大きさはx・y両方の成分から求める', () => {
  assert.equal(new Vector2(3, 4).magnitude, 5);
  assert.equal(new Vector2(-3, -4).magnitude, 5);
  const unit = new Vector2(3, 4).normarized;
  assert.equal(unit.x, 0.6);
  assert.equal(unit.y, 0.8);
});
// ゲームと同じく、幅20px・長さ120pxのバットを、グリップ側の端（原点）を中心に回して調べる。ボールの半径は20px。
const bat = { pivot: new Vector2(0, 0), width: 20, length: 120 };
for (const [name, degree, center, expected] of [
  ['-30度のとき、グリップの62px右・10px下は外れる', -30, [62, 10], false],
  ['-30度のとき、グリップの62px右・65px下は外れる', -30, [62, 65], false],
  ['-30度のとき、グリップの62px右・100px下は当たる', -30, [62, 100], true],
  ['水平のとき、上のラインの20px上は当たる', -90, [62, -20], true],
  [
    '水平のとき、上のラインの40px下（下のラインの20px下）は当たる',
    -90,
    [62, 40],
    true,
  ],
  ['水平のとき、上のラインの41px下は外れる', -90, [62, 41], false],
  ['水平のとき、上のラインの70px下は外れる', -90, [62, 70], false],
  ['水平のとき、バットの先の角から20px以内は当たる', -90, [134, 34], true],
  ['水平のとき、バットの先の角から20pxより遠いと外れる', -90, [135, 35], false],
])
  test(name, () =>
    assert.equal(
      isBallTouchingBat(bat, degree, new Vector2(...center), 20),
      expected,
    ),
  );
const frames = (...pairs) => pairs.map(([time, degree]) => ({ time, degree }));
test('判定と判定の間にバットがボールを通り過ぎたときは当たる', () => {
  // 前回は-30度でグリップの55px下、今回は-60度で85px下。どちらの時点もバットに触れていない。
  assert.equal(isBallTouchingBat(bat, -30, new Vector2(62, 55), 20), false);
  assert.equal(isBallTouchingBat(bat, -60, new Vector2(62, 85), 20), false);
  assert.equal(
    isBallHitDuringSwing(
      bat,
      frames([0, -30], [10, -40], [20, -50], [30, -60]),
      new Vector2(62, 55),
      new Vector2(62, 85),
      20,
    ),
    true,
  );
});
test('判定と判定の間にバットが先に通り過ぎ、ボールに触れなければ外れる', () => {
  assert.equal(
    isBallHitDuringSwing(
      bat,
      frames([0, -60], [10, -70], [20, -80], [30, -90]),
      new Vector2(62, -80),
      new Vector2(62, -50),
      20,
    ),
    false,
  );
});
test('振り終えて0度に戻る間の角度では当てない', () => {
  // -90度から0度へ戻る途中の-50度なら当たる位置のボール
  assert.equal(isBallTouchingBat(bat, -50, new Vector2(62, 75), 20), true);
  assert.equal(
    isBallHitDuringSwing(
      bat,
      frames([0, -80], [10, -90], [20, 0], [30, 0]),
      new Vector2(62, 75),
      new Vector2(62, 75),
      20,
    ),
    false,
  );
});
test('前回の判定の直後に0度へ戻したときは、後から水平のバットの位置へ来たボールを当てない', () => {
  assert.equal(
    isBallHitDuringSwing(
      bat,
      frames([0, -90], [0, 0], [30, 0]),
      new Vector2(62, -25),
      new Vector2(62, -15),
      20,
    ),
    false,
  );
  // 同じボールの動きでも、バットが水平のままなら途中で当たる。
  assert.equal(
    isBallHitDuringSwing(
      bat,
      frames([0, -90], [30, -90]),
      new Vector2(62, -25),
      new Vector2(62, -15),
      20,
    ),
    true,
  );
});
test('ビルド後にもゲームの入口・画像・スタイルが配信される', () => {
  for (const file of [
    'index.html',
    'main.js',
    'style/index.css',
    'image/ball.png',
    'image/bat.png',
    'image/guest.png',
  ]) {
    assert.ok(fs.statSync(`publish/${file}`).size > 0, file);
  }
  const html = fs.readFileSync('publish/index.html', 'utf8');
  assert.match(html, /main\.js/);
  assert.match(html, /style\/index\.css/);
});

// 画像は加工せず配信する。存在確認だけでは文字コード変換による破損を検出できない。
test('配信する全画像とfaviconは元ファイルのバイナリを保持する', () => {
  for (const file of fs.readdirSync('src/image', { recursive: true })) {
    const source = `src/image/${file}`;
    if (!fs.statSync(source).isFile()) continue;
    assert.ok(
      fs.readFileSync(`publish/image/${file}`).equals(fs.readFileSync(source)),
      `image/${file} must match the source bytes`,
    );
  }
  const favicon = fs.readFileSync('publish/image/favicon.png');
  assert.ok(
    favicon
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'favicon must be a PNG image',
  );
  const html = fs.readFileSync('publish/index.html', 'utf8');
  const iconLink = html.match(/<link\b[^>]*\brel=["']?icon["']?[^>]*>/)?.[0];
  assert.ok(iconLink, 'favicon link must exist');
  assert.match(iconLink, /\btype=["']?image\/png(?:["'\s>])/);
  assert.match(iconLink, /\bhref=["']?\.\/image\/favicon\.png(?:["'\s>])/);
});

test('配信HTMLはJS・CSSの内容に一致するキャッシュ識別子を参照する', () => {
  const { createHash } = require('node:crypto');
  const html = fs.readFileSync('publish/index.html', 'utf8');
  for (const [attribute, file] of [
    ['src', 'main.js'],
    ['href', './style/index.css'],
  ]) {
    const hash = createHash('sha256')
      .update(fs.readFileSync(`publish/${file}`))
      .digest('hex');
    assert.ok(html.includes(`${attribute}="${file}?v=${hash}"`), file);
  }
  assert.equal(html.includes('ver=1.0.1'), false);
});
