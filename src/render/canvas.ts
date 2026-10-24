import { apply, type Mat2, type Vec2 } from '../game/matrix.ts';
import type { Level } from '../game/state.ts';

/** 世界坐标 → 屏幕坐标（y 轴向上为正，屏幕翻转） */
export interface View {
  scale: number;
  cx: number;
  cy: number;
}

/** 位图按 devicePixelRatio 放大，绘制坐标系始终使用逻辑像素（800×600），避免缩放模糊/错位 */
function deviceDpr(): number {
  return Math.max(1, window.devicePixelRatio || 1);
}

export function createView(canvas: HTMLCanvasElement): View {
  const dpr = deviceDpr();
  return { scale: 36, cx: canvas.width / dpr / 2, cy: canvas.height / dpr / 2 };
}

function toScreen(view: View, p: Vec2): Vec2 {
  return [view.cx + p[0] * view.scale, view.cy - p[1] * view.scale];
}

const GRID_EXTENT = 10;
const AXIS_X_COLOR = '#5b8bd4';
const AXIS_Y_COLOR = '#36D6C1';
const AXIS_FONT = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
const FIXED_AXIS_COLOR = 'rgba(154, 163, 184, 0.6)';

/** 画三角箭头（u 为单位方向） */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tip: Vec2,
  ux: number,
  uy: number,
  size: number,
  color: string,
): void {
  const a = 0.42;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(
    tip[0] - size * (ux * Math.cos(a) - uy * Math.sin(a)),
    tip[1] - size * (uy * Math.cos(a) + ux * Math.sin(a)),
  );
  ctx.lineTo(
    tip[0] - size * (ux * Math.cos(a) + uy * Math.sin(a)),
    tip[1] - size * (uy * Math.cos(a) - ux * Math.sin(a)),
  );
  ctx.closePath();
  ctx.fill();
}

/** 固定参考系坐标轴：不随 M 变换，始终水平/垂直，灰色虚线，数字每 2 单位、放在轴线另一侧 */
function drawFixedAxes(ctx: CanvasRenderingContext2D, view: View): void {
  const dpr = deviceDpr();
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
  const o = toScreen(view, [0, 0]);

  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = FIXED_AXIS_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, o[1]);
  ctx.lineTo(w, o[1]);
  ctx.moveTo(o[0], 0);
  ctx.lineTo(o[0], h);
  ctx.stroke();
  ctx.setLineDash([]);

  const xEnd = Math.min(w - 14, o[0] + GRID_EXTENT * view.scale);
  drawArrowHead(ctx, [xEnd, o[1]], 1, 0, 7, FIXED_AXIS_COLOR);
  const yEnd = Math.max(14, o[1] - GRID_EXTENT * view.scale);
  drawArrowHead(ctx, [o[0], yEnd], 0, -1, 7, FIXED_AXIS_COLOR);

  // 轴名放在负方向端，避开随矩阵变换的彩色轴名
  ctx.fillStyle = FIXED_AXIS_COLOR;
  ctx.font = 'bold 12px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('x', Math.max(10, o[0] - GRID_EXTENT * view.scale + 6), o[1] - 11);
  ctx.fillText('y', o[0] - 11, Math.min(h - 10, o[1] + GRID_EXTENT * view.scale - 6));

  ctx.font = AXIS_FONT;
  for (let i = -8; i <= 8; i += 2) {
    if (i === 0) continue;
    const px = o[0] + i * view.scale;
    const py = o[1] - i * view.scale;
    if (px > 12 && px < w - 12) ctx.fillText(String(i), px, o[1] - 11);
    if (py > 10 && py < h - 10) ctx.fillText(String(i), o[0] - 12, py);
  }
  ctx.restore();
}

/** 从屏幕点 p 沿单位方向 u 走到画布边缘（留 margin）的像素距离 */
function reachToEdge(p: Vec2, u: Vec2, w: number, h: number, margin = 14): number {
  let best = Infinity;
  if (u[0] > 1e-9) best = Math.min(best, (w - margin - p[0]) / u[0]);
  else if (u[0] < -1e-9) best = Math.min(best, (margin - p[0]) / u[0]);
  if (u[1] > 1e-9) best = Math.min(best, (h - margin - p[1]) / u[1]);
  else if (u[1] < -1e-9) best = Math.min(best, (margin - p[1]) / u[1]);
  return Math.max(0, best);
}

/** 画一条坐标轴（轴线 + 正方向箭头 + 轴名），方向随 M 变换；被压缩成点时跳过 */
function drawAxis(ctx: CanvasRenderingContext2D, view: View, M: Mat2, axis: 'x' | 'y', color: string): void {
  const at = (t: number): Vec2 => toScreen(view, apply(M, axis === 'x' ? [t, 0] : [0, t]));
  const origin = at(0);
  const unit = at(1);
  const dx = unit[0] - origin[0];
  const dy = unit[1] - origin[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-3) return; // 投影把该轴压成了一个点
  const ux = dx / len;
  const uy = dy / len;

  const neg = at(-GRID_EXTENT);
  const pos = at(GRID_EXTENT);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(neg[0], neg[1]);
  ctx.lineTo(pos[0], pos[1]);
  ctx.stroke();

  // 正方向箭头：截到画布边缘，保证始终可见
  const dpr = deviceDpr();
  const tEnd = Math.min(
    GRID_EXTENT,
    reachToEdge(origin, [ux, uy], ctx.canvas.width / dpr, ctx.canvas.height / dpr) / len,
  );
  if (tEnd > 0.8) drawArrowHead(ctx, at(tEnd), ux, uy, 8, color);

  // 轴名：沿正方向靠近箭头处，向侧边让开轴线
  const titleAt = at(Math.max(1, tEnd * 0.86));
  ctx.fillStyle = color;
  ctx.font = 'bold 13px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(axis, titleAt[0] - uy * 12, titleAt[1] + ux * 12);
}

/** 沿两条轴画整数刻度与坐标数字；投影重叠时按屏幕距离去重 */
function drawAxisTicks(ctx: CanvasRenderingContext2D, view: View, M: Mat2): void {
  const dpr = deviceDpr();
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
  const seen: Vec2[] = [];
  for (const axis of ['x', 'y'] as const) {
    const color = axis === 'x' ? AXIS_X_COLOR : AXIS_Y_COLOR;
    const at = (t: number): Vec2 => toScreen(view, apply(M, axis === 'x' ? [t, 0] : [0, t]));
    const origin = at(0);
    const unit = at(1);
    const dx = unit[0] - origin[0];
    const dy = unit[1] - origin[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const px = -dy / len; // 屏幕上的垂直方向，用于刻度和数字偏移
    const py = dx / len;

    for (let i = -8; i <= 8; i++) {
      if (i === 0) continue;
      const p = at(i);
      if (p[0] < 0 || p[0] > w || p[1] < 0 || p[1] > h) continue;
      if (seen.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 14)) continue;
      seen.push(p);

      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p[0] - px * 4, p[1] - py * 4);
      ctx.lineTo(p[0] + px * 4, p[1] + py * 4);
      ctx.stroke();

      ctx.globalAlpha = 0.85;
      ctx.fillStyle = color;
      ctx.font = AXIS_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i), p[0] + px * 11, p[1] + py * 11);
    }
  }
  ctx.globalAlpha = 1;

  const o = toScreen(view, apply(M, [0, 0]));
  ctx.fillStyle = '#9aa3b8';
  ctx.font = AXIS_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('O', o[0] - 9, o[1] + 11);
}

/** 网格线整体经 M 变换（线性映射下线段仍是线段，变换端点即可）。ghost=true 画空间虚影 */
function drawGrid(ctx: CanvasRenderingContext2D, view: View, M: Mat2, ghost = false): void {
  if (ghost) ctx.setLineDash([4, 4]);
  for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
    if (i === 0 && !ghost) continue; // 坐标轴单独绘制
    const isAxis = i === 0;
    ctx.strokeStyle = ghost ? 'rgba(120, 168, 255, 0.22)' : isAxis ? '#3d4a6b' : '#263049';
    ctx.lineWidth = isAxis ? 1.5 : 1;
    let a = toScreen(view, apply(M, [i, -GRID_EXTENT]));
    let b = toScreen(view, apply(M, [i, GRID_EXTENT]));
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    a = toScreen(view, apply(M, [-GRID_EXTENT, i]));
    b = toScreen(view, apply(M, [GRID_EXTENT, i]));
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  if (ghost) {
    ctx.setLineDash([]);
    return;
  }
  drawFixedAxes(ctx, view);
  drawAxis(ctx, view, M, 'x', AXIS_X_COLOR);
  drawAxis(ctx, view, M, 'y', AXIS_Y_COLOR);
  drawAxisTicks(ctx, view, M);
  ctx.globalAlpha = 1;
}

/** 禁区：固定不动（与锁一致），按世界坐标画轴对齐矩形；highlight 下标的禁区加亮 */
function drawZones(
  ctx: CanvasRenderingContext2D,
  view: View,
  level: Level,
  highlight: number | null,
): void {
  level.forbidden.forEach((zone, i) => {
    const [sx, sy] = toScreen(view, [zone.x, zone.y + zone.h]);
    const w = zone.w * view.scale;
    const h = zone.h * view.scale;
    const hot = highlight === i;
    ctx.fillStyle = hot ? 'rgba(251, 113, 133, 0.5)' : 'rgba(251, 113, 133, 0.18)';
    ctx.fillRect(sx, sy, w, h);
    ctx.strokeStyle = '#FB7185';
    ctx.lineWidth = hot ? 3 : 1.5;
    ctx.strokeRect(sx, sy, w, h);
  });
}

/** 钥匙：形状定义在房间世界坐标中，随 M 一起变换（剪切/缩放时随形变）。
 *  锚点取钥匙环中心，保证判定命中时钥匙环正好压在锁上。 */
function drawKey(ctx: CanvasRenderingContext2D, view: View, level: Level, M: Mat2): void {
  const [kx, ky] = level.key;
  const pt = (dx: number, dy: number): Vec2 => toScreen(view, apply(M, [kx + dx, ky + dy]));
  ctx.strokeStyle = '#FFC857';
  ctx.lineWidth = Math.max(2, view.scale * 0.07);
  // 钥匙环（12 边形逼近圆，保证随形变正确变换），环心即钥匙锚点
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const [sx, sy] = pt(Math.cos(a) * 0.14, Math.sin(a) * 0.14);
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.stroke();
  // 钥匙柄与齿
  const stem1 = pt(0.14, 0);
  const stem2 = pt(0.45, 0);
  ctx.beginPath();
  ctx.moveTo(stem1[0], stem1[1]);
  ctx.lineTo(stem2[0], stem2[1]);
  const t1a = pt(0.33, 0);
  const t1b = pt(0.33, -0.11);
  const t2a = pt(0.45, 0);
  const t2b = pt(0.45, -0.11);
  ctx.moveTo(t1a[0], t1a[1]);
  ctx.lineTo(t1b[0], t1b[1]);
  ctx.moveTo(t2a[0], t2a[1]);
  ctx.lineTo(t2b[0], t2b[1]);
  ctx.stroke();
}

/** 锁：固定不动，不随 M 变换；victory 时叠加成功绿光晕与少量星芒 */
function drawLock(ctx: CanvasRenderingContext2D, view: View, level: Level, victory = false): void {
  const [x, y] = toScreen(view, level.lock);
  const s = view.scale;
  const w = 0.6 * s;
  const h = 0.5 * s;
  ctx.save();
  if (victory) {
    ctx.shadowColor = 'rgba(74, 222, 128, 0.85)';
    ctx.shadowBlur = 22;
  }
  ctx.strokeStyle = '#4ADE80';
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.beginPath();
  ctx.arc(x, y - h / 2, 0.18 * s, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#4ADE80';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#0B1020';
  ctx.beginPath();
  ctx.arc(x, y, 0.08 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (victory) {
    // 四角星芒：金色小菱形点缀，呼应钥匙色
    ctx.fillStyle = '#FFC857';
    ctx.globalAlpha = 0.9;
    const gap = w * 0.62;
    const r = s * 0.09;
    for (const [dx, dy] of [
      [gap, -gap * 0.55],
      [-gap, -gap * 0.55],
      [gap, gap * 0.55],
      [-gap, gap * 0.55],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x + dx, y + dy - r);
      ctx.lineTo(x + dx + r * 0.55, y + dy);
      ctx.lineTo(x + dx, y + dy + r);
      ctx.lineTo(x + dx - r * 0.55, y + dy);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/** 钥匙落点虚影：ghostM 为“打出预览矩阵之后”的累积矩阵 */
function drawGhostKey(ctx: CanvasRenderingContext2D, view: View, level: Level, ghostM: Mat2): void {
  const [px, py] = toScreen(view, apply(ghostM, level.key));
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(255, 200, 87, 0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(px, py, view.scale * 0.16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawScene(
  canvas: HTMLCanvasElement,
  view: View,
  level: Level,
  M: Mat2,
  highlightZone: number | null = null,
  ghostM: Mat2 | null = null,
  victory = false,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = deviceDpr();
  const w = canvas.width / dpr;
  const h = canvas.height / dpr;
  // 位图为逻辑尺寸 × DPR：先切到逻辑坐标系绘制，CSS 缩放到位图时保持等比例、无模糊
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#0B1020';
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, view, M);
  if (ghostM) drawGrid(ctx, view, ghostM, true);
  drawZones(ctx, view, level, highlightZone);
  if (ghostM) drawGhostKey(ctx, view, level, ghostM);
  drawLock(ctx, view, level, victory);
  drawKey(ctx, view, level, M);
}
