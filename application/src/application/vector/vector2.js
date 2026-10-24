// https://github.com/kurodakazumichi/teaching_materials/blob/master/pg_and_math/Vector2/vector2.js

export default class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  static sub(v0, v1) {
    return v0.clone().sub(v1);
  }

  get magnitude() {
    const { x, y } = this;
    return Math.sqrt(x ** 2 + y ** 2);
  }

  get normarized() {
    const { x, y } = this;
    return new Vector2(x / this.magnitude, y / this.magnitude);
  }

  static dot(v0, v1) {
    return v0.x * v1.x + v0.y * v1.y;
  }

  static cross(v0, v1) {
    return v0.x * v1.y - v0.y * v1.x;
  }
}
