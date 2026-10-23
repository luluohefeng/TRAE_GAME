import type { Mat2 } from './matrix.ts';

/** 矩阵元素逐分量线性插值 */
export function lerpMat2(A: Mat2, B: Mat2, t: number): Mat2 {
  const l = (a: number, b: number) => a + (b - a) * t;
  return [
    [l(A[0][0], B[0][0]), l(A[0][1], B[0][1])],
    [l(A[1][0], B[1][0]), l(A[1][1], B[1][1])],
  ];
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * 用 requestAnimationFrame 在 durationMs 内把矩阵从 from 插值到 to。
 * onUpdate 每帧回调插值矩阵，onDone 结束时回调一次。
 * 返回取消函数。调用方负责在动画期间冻结判定与输入按钮。
 */
export function animateMatrix(
  from: Mat2,
  to: Mat2,
  durationMs: number,
  onUpdate: (m: Mat2) => void,
  onDone: () => void,
): () => void {
  const start = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const raw = Math.min(1, (now - start) / durationMs);
    onUpdate(lerpMat2(from, to, easeInOutQuad(raw)));
    if (raw < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      onDone();
    }
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}
