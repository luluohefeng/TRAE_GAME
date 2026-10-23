import katex from 'katex';
import 'katex/dist/katex.min.css';
import type { Mat2 } from '../game/matrix.ts';

/** latex → 渲染后 HTML 的缓存（公式全部来自代码内拼串，绝不接受玩家输入） */
const cache = new Map<string, string>();

/**
 * 用 katex.render 把 latex 渲染进 el；相同 latex 命中缓存直接写 innerHTML。
 * throwOnError:false —— 渲染失败时 KaTeX 原样回显源码，不抛异常。
 * 只允许在出牌结算后/撤销/重置/切关时调用，禁止逐帧调用。
 */
export function renderLatex(latex: string, el: HTMLElement): void {
  let html = cache.get(latex);
  if (html === undefined) {
    const tmp = document.createElement('span');
    katex.render(latex, tmp, { throwOnError: false });
    html = tmp.innerHTML;
    cache.set(latex, html);
  }
  el.innerHTML = html;
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

/** 2x2 矩阵 → bmatrix 公式 */
export function toMatrixLatex(mat: Mat2): string {
  const a = fmt(mat[0][0]);
  const b = fmt(mat[0][1]);
  const c = fmt(mat[1][0]);
  const d = fmt(mat[1][1]);
  return `\\begin{bmatrix}${a}&${b}\\\\${c}&${d}\\end{bmatrix}`;
}
