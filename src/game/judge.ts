import { apply, isInvertible, type Vec2 } from './matrix.ts';
import type { ForbiddenZone, GameState, GameStatus } from './state.ts';

export const WIN_THRESHOLD = 0.15;

export type FailReason = 'forbidden' | 'steps' | 'projection' | null;

export interface EvalResult {
  status: GameStatus;
  reason: FailReason;
  /** 命中禁区的下标（reason 为 forbidden 时有效），供 UI 高亮 */
  zoneIndex: number | null;
}

function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** 禁区固定不动（与锁一致）：直接测世界坐标点是否落在轴对齐矩形内 */
function pointInZone(p: Vec2, zone: ForbiddenZone): boolean {
  return p[0] >= zone.x && p[0] <= zone.x + zone.w && p[1] >= zone.y && p[1] <= zone.y + zone.h;
}

/**
 * 判定（锁与禁区均固定不动；钥匙随 M 变换）。
 * 顺序：禁区（立即失败）→ 胜利（dist < 0.15）→ 投影（det = 0 后再无胜机，立即失败）→ 超步数。
 * 胜利先于投影/步数检查：投影卡恰好把钥匙压到锁上也算赢，最后一步压线到达也算赢。
 */
export function evaluate(state: GameState): EvalResult {
  const { M, level } = state;
  const key = apply(M, level.key);

  for (let i = 0; i < level.forbidden.length; i++) {
    if (pointInZone(key, level.forbidden[i])) {
      return { status: 'lost', reason: 'forbidden', zoneIndex: i };
    }
  }
  if (dist(key, level.lock) < WIN_THRESHOLD) {
    return { status: 'won', reason: null, zoneIndex: null };
  }
  if (!isInvertible(M)) {
    return { status: 'lost', reason: 'projection', zoneIndex: null };
  }
  if (state.stepsUsed > level.maxSteps) {
    return { status: 'lost', reason: 'steps', zoneIndex: null };
  }
  return { status: 'playing', reason: null, zoneIndex: null };
}

export function judge(state: GameState): GameStatus {
  return evaluate(state).status;
}
