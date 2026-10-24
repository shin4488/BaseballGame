import Vector2 from '../vector/vector2';

/**
 * 円（ボール）が線分（バット）に当たっているかを判定する。
 * maxAllowedLateHitは、円の中心から線分を延ばした直線までの符号付き距離（始点が左・終点が右の線分では上側が正）の下限。負の値にすると、円の中心が線分より下にある振り遅れも、その距離までは当たりにする。
 */
export const isHitCircleToLine = (
  lineStartVec2,
  lineEndVec2,
  circleCentervec2,
  circleRadius,
  maxAllowedLateHit,
) => {
  const lineStartToEnd = Vector2.sub(lineEndVec2, lineStartVec2);
  const lineStartToCircleCenter = Vector2.sub(circleCentervec2, lineStartVec2);
  const lineEndToCircleCenter = Vector2.sub(circleCentervec2, lineEndVec2);

  // 円の中心から、線分を延ばした直線までの符号付き距離
  const minDistanceLineToCircle = Vector2.cross(
    lineStartToCircleCenter,
    lineStartToEnd.normarized,
  );

  if (
    minDistanceLineToCircle < maxAllowedLateHit ||
    minDistanceLineToCircle >= circleRadius
  ) {
    return false;
  }

  // 円の中心から直線へ下ろした垂線の足が、線分の両端の間にあるか
  const dotLineStartCircleCenter = Vector2.dot(
    lineStartToEnd,
    lineStartToCircleCenter,
  );
  const dotLineEndCircleCenter = Vector2.dot(
    lineStartToEnd,
    lineEndToCircleCenter,
  );
  const isCircleWithinLine =
    dotLineStartCircleCenter * dotLineEndCircleCenter <= 0;

  // 線分の端点が円の内側にあるか
  const magnitudeLineStartToCircleCenter = lineStartToCircleCenter.magnitude;
  const magnitudeLineEndToCircleCenter = lineEndToCircleCenter.magnitude;
  const isCircleWithinLineEdge =
    magnitudeLineStartToCircleCenter < circleRadius ||
    magnitudeLineEndToCircleCenter < circleRadius;

  return isCircleWithinLine || isCircleWithinLineEdge;
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
 * min以上max以下の整数の乱数を返す。引数の順はmax、min。
 */
export const getRandomNumber = (max, min) => {
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
