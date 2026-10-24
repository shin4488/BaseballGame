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
const { getResultMessage, getRandomNumber, isHitCircleToLine } = load(
  'src/application/vue/process.js',
);
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
// ゲームと同じく、半径20pxのボールと、下へ70pxまでの振り遅れを当たりとする水平なバットで調べる。
for (const [name, center, expected] of [
  [
    'バットの右端から右へ10px・下へ15px（端点まで18px）は当たる',
    [110, 15],
    true,
  ],
  [
    'バットの左端から左へ10px・上へ15px（端点まで18px）は当たる',
    [-10, -15],
    true,
  ],
  [
    'バットの右端から右へ15px・下へ15px（端点まで21px）は外れる',
    [115, 15],
    false,
  ],
  [
    'バットの右端から右へ10px・下へ50px（端点まで51px）は外れる',
    [110, 50],
    false,
  ],
  ['バットの両端の間なら、下へ50pxの振り遅れも当たる', [100, 50], true],
])
  test(name, () =>
    assert.equal(
      isHitCircleToLine(
        new Vector2(0, 0),
        new Vector2(100, 0),
        new Vector2(...center),
        20,
        -70,
      ),
      expected,
    ),
  );
test('斜めの線分では、線分を延ばした直線までの距離で判定する', () => {
  // 直線までの距離は (60 - 40) / √2 ≈ 14.1px で、半径の20px未満
  assert.equal(
    isHitCircleToLine(
      new Vector2(0, 0),
      new Vector2(100, 100),
      new Vector2(60, 40),
      20,
      -20,
    ),
    true,
  );
  // 直線までの距離は (65 - 35) / √2 ≈ 21.2px
  assert.equal(
    isHitCircleToLine(
      new Vector2(0, 0),
      new Vector2(100, 100),
      new Vector2(65, 35),
      20,
      -20,
    ),
    false,
  );
});
test('水平バットの中央で当たり、十分離れたボールは外れる', () => {
  assert.equal(
    isHitCircleToLine(
      new Vector2(0, 0),
      new Vector2(10, 0),
      new Vector2(5, 0),
      1,
      -1,
    ),
    true,
  );
  assert.equal(
    isHitCircleToLine(
      new Vector2(0, 0),
      new Vector2(10, 0),
      new Vector2(30, 0),
      1,
      -1,
    ),
    false,
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
