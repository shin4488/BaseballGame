import Vector2 from '../vector/vector2';

/**
 * ボールの中心から、回転したバットの枠までの距離。中心が枠の中にあれば0。
 * バットは、回転前は幅bat.width・長さbat.lengthの縦長の長方形で、右上の角（グリップ側の端）bat.pivotを中心にdegree度回転させて描く。degreeが負のときは、画面上で反時計回りに回る。
 */
export const getDistanceToBat = (bat, degree, ballCenter) => {
  const radian = (degree * Math.PI) / 180;
  const pivotToBall = Vector2.sub(ballCenter, bat.pivot);
  // 回転を戻した座標では、バットはxが-width〜0、yが0〜lengthの範囲にある。
  const x = Vector2.dot(
    pivotToBall,
    new Vector2(Math.cos(radian), Math.sin(radian)),
  );
  const y = Vector2.dot(
    pivotToBall,
    new Vector2(-Math.sin(radian), Math.cos(radian)),
  );
  return new Vector2(
    Math.max(-bat.width - x, 0, x),
    Math.max(-y, 0, y - bat.length),
  ).magnitude;
};

/**
 * ボール（円）が、回転したバットの枠に重なっているかを判定する。
 */
export const isBallTouchingBat = (bat, degree, ballCenter, ballRadius) =>
  // 三角関数の誤差で、ちょうど半径だけ離れたボールを外れにしない。
  getDistanceToBat(bat, degree, ballCenter) <= ballRadius + 1e-9;

/**
 * 前回の判定から今回の判定までの間に、ボールがバットに触れたかを判定する。
 * batFramesは、バットの角度と、その角度を描き始めた時刻（{ time, degree }）を描いた順に並べたもの。先頭は前回の判定、末尾は今回の判定の時点の角度とする。
 * ボールは、前回の判定の時刻にpreviousBallCenter、今回の判定の時刻にballCenterにあり、その間を一定の速さで動くとみなす。
 * バットは描いた角度に止まっていて、振る向き（角度が減る向き）に描き替えた瞬間に、間の角度を順に通るとみなす。振り終えて0度に戻るときは、間の角度を通らない。
 */
export const isBallHitDuringSwing = (
  bat,
  batFrames,
  previousBallCenter,
  ballCenter,
  ballRadius,
) => {
  const startTime = batFrames[0].time;
  const duration = batFrames[batFrames.length - 1].time - startTime;
  const ballMove = Vector2.sub(ballCenter, previousBallCenter);
  const isTouchingAt = (degree, time) => {
    const ratio =
      duration > 0
        ? Math.min(Math.max((time - startTime) / duration, 0), 1)
        : 1;
    const center = new Vector2(
      previousBallCenter.x + ballMove.x * ratio,
      previousBallCenter.y + ballMove.y * ratio,
    );
    return isBallTouchingBat(bat, degree, center, ballRadius);
  };

  // ボールが1px、バットが1度（バットの先で約2px）動くごとに調べる。
  const ballSpeed = duration > 0 ? ballMove.magnitude / duration : 0;
  for (let index = 0; index < batFrames.length - 1; index++) {
    const { time, degree } = batFrames[index];
    const next = batFrames[index + 1];
    // 次に描き替えるまで、バットは止まり、ボールだけが動く。
    const ballSteps = Math.max(1, Math.ceil(ballSpeed * (next.time - time)));
    for (let step = 0; step < ballSteps; step++) {
      const stepTime = time + ((next.time - time) * step) / ballSteps;
      if (isTouchingAt(degree, stepTime)) return true;
    }
    // 描き替えた瞬間に、バットだけが動く。角度が増える（0度に戻る）ときは調べない。
    const swingSteps = Math.ceil(degree - next.degree);
    for (let step = 0; step < swingSteps; step++) {
      const stepDegree = degree - ((degree - next.degree) * step) / swingSteps;
      if (isTouchingAt(stepDegree, next.time)) return true;
    }
  }
  const last = batFrames[batFrames.length - 1];
  return isTouchingAt(last.degree, last.time);
};

/**
 * 上向きの打球が的の下面へ最初に触れる時刻（1更新を0〜1とする）。
 * 前後の座標を結ぶ軌道と、ボール半径を持つ線分との交差を調べる。
 * 命中しない場合はnull。端の丸みも調べ、隣の的への誤判定を防ぐ。
 */
export const getBoardHitTime = (previous, current, radius, board) => {
  if (!previous || current.y >= previous.y) return null;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  const closestX = Math.max(board.left, Math.min(board.right, previous.x));
  if (
    (previous.x - closestX) ** 2 + (previous.y - board.bottom) ** 2 <=
    radius ** 2
  ) {
    return 0;
  }

  const times = [];
  // 線分の中央部分には、ボールの上端が下面に達した時点で触れる。
  const time = (board.bottom + radius - previous.y) / dy;
  const x = previous.x + dx * time;
  if (time >= 0 && time <= 1 && x >= board.left && x <= board.right) {
    times.push(time);
  }
  // 線分の両端では、移動する円と端点の接触時刻を求める。
  const a = dx * dx + dy * dy;
  for (const edge of [board.left, board.right]) {
    const ox = previous.x - edge;
    const oy = previous.y - board.bottom;
    const b = 2 * (ox * dx + oy * dy);
    const c = ox * ox + oy * oy - radius * radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const edgeTime = (-b - Math.sqrt(discriminant)) / (2 * a);
    if (edgeTime >= 0 && edgeTime <= 1) times.push(edgeTime);
  }
  return times.length ? Math.min(...times) : null;
};

/**
 * min以上max以下の整数の乱数を返す。
 */
export const getRandomNumber = (min, max) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

export const getResultMessage = (totalPoint) => {
  const pointMessage = ` ${totalPoint} 得点`;
  return totalPoint === 0
    ? `あきらめないで！${pointMessage}`
    : totalPoint < 10
      ? `調子が出てきた！${pointMessage}`
      : totalPoint < 20
        ? `やったね！${pointMessage}`
        : totalPoint < 50
          ? `うまい！${pointMessage}`
          : `プロ野球選手も夢じゃない！${pointMessage}`;
};
