import Vector2 from '../vector/vector2';

/**
 * 円と線分の当たり判定
 * @param {*} lineStartVec2
 * @param {*} lineEndVec2
 * @param {*} circleCentervec2
 * @param {*} circleRadius
 * @param {*} maxAllowedLateHIt
 * @returns
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

  // 『「円の中心」と「線分」の最短距離 < 円の半径』のチェック
  const minDistanceLineToCircle = Vector2.cross(
    lineStartToCircleCenter,
    lineStartToEnd.normarized,
  );

  // 「円の中心」と「線分」の最短距離が、円の半径より大きい時は当たっていない
  // ボールが線分より下にあるのをどこまで許容するかは個別処理側で決める
  if (
    minDistanceLineToCircle < maxAllowedLateHit ||
    minDistanceLineToCircle >= circleRadius
  ) {
    return false;
  }

  // 円が線分の範囲内にあることのチェック
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

  // 円が線分の末端内にあることのチェック
  const magnitudeLineStartToCircleCenter = lineStartToCircleCenter.magnitude;
  const magnitudeLineEndToCircleCenter = lineEndToCircleCenter.magnitude;
  const isCircleWithinLineEdge =
    magnitudeLineStartToCircleCenter < circleRadius ||
    magnitudeLineEndToCircleCenter < circleRadius;

  // 当たり判定
  return isCircleWithinLine || isCircleWithinLineEdge;
};

/**
 * 乱数発生
 * @param {*} max
 * @param {*} min
 * @returns
 */
export const getRandomNumber = (max, min) => {
  return Math.floor(Math.random() * (max - min + 1) + min);
};

/**
 * 得点時応じて結果メッセージを取得
 * @param {*} totalPoint
 * @returns
 */
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
