// https://github.com/kurodakazumichi/teaching_materials/blob/master/pg_and_math/Vector2/vector2.js

/**
 * 2次元ベクトルクラス
 */
export default class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /**
   * 複製
   */
  clone() {
    return new Vector2(this.x, this.y);
  }

  /**
   * 引き算
   */
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  static sub(v0, v1) {
    return v0.clone().sub(v1);
  }

  /**
   * ベクトルの大きさ
   */
  get magnitude() {
    const { x, y } = this;
    return Math.sqrt(x ** 2, y ** 2);
  }

  /**
   * 正規化
   * 大きさ1のベクトル
   */
  get normarized() {
    const { x, y } = this;
    return new Vector2(x / this.magnitude, y / this.magnitude);
  }

  /**
   * 内積
   */
  static dot(v0, v1) {
    return v0.x * v1.x + v0.y * v1.y;
  }

  /**
   * 外積
   */
  static cross(v0, v1) {
    return v0.x * v1.y - v0.y * v1.x;
  }
}
