// 2x2 矩阵纯函数实现。约定：列向量 p，p' = M · p。
export type Mat2 = [[number, number], [number, number]];
export type Vec2 = [number, number];

export const IDENTITY: Mat2 = [[1, 0], [0, 1]];

/** 矩阵乘法 A·B（几何意义：先应用 B，再应用 A） */
export function multiply(A: Mat2, B: Mat2): Mat2 {
  return [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
  ];
}

/** 矩阵作用于点：p' = M · p */
export function apply(m: Mat2, p: Vec2): Vec2 {
  return [
    m[0][0] * p[0] + m[0][1] * p[1],
    m[1][0] * p[0] + m[1][1] * p[1],
  ];
}

export function det(m: Mat2): number {
  return m[0][0] * m[1][1] - m[0][1] * m[1][0];
}

export function isInvertible(m: Mat2, eps = 1e-9): boolean {
  return Math.abs(det(m)) > eps;
}
