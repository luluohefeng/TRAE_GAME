import { apply, type Mat2, type Vec2 } from '../game/matrix.ts';
import type { Level } from '../game/state.ts';

/** 世界坐标 → 屏幕坐标（y 轴向上为正，屏幕翻转） */
export interface View {
  scale: number;
  cx: number;
  cy: number;
}

export function createView(canvas: HTMLCanvasElement): View {
  return { scale: 36, cx: canvas.width / 2, cy: canvas.height / 2 };
}

function toScreen(view: View, p: Vec2): Vec2 {
  return [view.cx + p[0] * view.scale, view.cy - p[1] * view.scale];
}

const GRID_EXTENT = 10;

/** 网格线整体经 M 变换（线性映射下线段仍是线段，变换端点即可）。ghost=true 画空间虚影 */
function drawGrid(ctx: CanvasRenderingContext2D, view: View, M: Mat2, ghost = false): void {
  if (ghost) ctx.setLineDash([4, 4]);
  for (let i = -GRID_EXTENT; i <= GRID_EXTENT; i++) {
    const isAxis = i === 0;
    ctx.strokeStyle = ghost ? 'rgba(120, 168, 255, 0.22)' : isAxis ? '#3d4a6b' : '#263049';
    ctx.lineWidth = isAxis && !ghost ? 1.5 : 1;
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
  if (ghost) ctx.setLineDash([]);
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
    ctx.fillStyle = hot ? 'rgba(224, 82, 82, 0.45)' : 'rgba(224, 82, 82, 0.15)';
    ctx.fillRect(sx, sy, w, h);
    ctx.strokeStyle = '#e05252';
    ctx.lineWidth = hot ? 3 : 1.5;
    ctx.strokeRect(sx, sy, w, h);
  });
}

/** 钥匙：形状定义在房间世界坐标中，随 M 一起变换（剪切/缩放时随形变）。
 *  锚点取钥匙环中心，保证判定命中时钥匙环正好压在锁上。 */
function drawKey(ctx: CanvasRenderingContext2D, view: View, level: Level, M: Mat2): void {
  const [kx, ky] = level.key;
  const pt = (dx: number, dy: number): Vec2 => toScreen(view, apply(M, [kx + dx, ky + dy]));
  ctx.strokeStyle = '#f2c14e';
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

/** 锁：固定不动，不随 M 变换 */
function drawLock(ctx: CanvasRenderingContext2D, view: View, level: Level): void {
  const [x, y] = toScreen(view, level.lock);
  const s = view.scale;
  const w = 0.6 * s;
  const h = 0.5 * s;
  ctx.strokeStyle = '#43d17c';
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.beginPath();
  ctx.arc(x, y - h / 2, 0.18 * s, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = '#43d17c';
  ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#0b0e14';
  ctx.beginPath();
  ctx.arc(x, y, 0.08 * s, 0, Math.PI * 2);
  ctx.fill();
}

/** 钥匙落点虚影：ghostM 为“打出预览矩阵之后”的累积矩阵 */
function drawGhostKey(ctx: CanvasRenderingContext2D, view: View, level: Level, ghostM: Mat2): void {
  const [px, py] = toScreen(view, apply(ghostM, level.key));
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(242, 193, 78, 0.65)';
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
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#141824';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx, view, M);
  if (ghostM) drawGrid(ctx, view, ghostM, true);
  drawZones(ctx, view, level, highlightZone);
  if (ghostM) drawGhostKey(ctx, view, level, ghostM);
  drawLock(ctx, view, level);
  drawKey(ctx, view, level, M);
}
