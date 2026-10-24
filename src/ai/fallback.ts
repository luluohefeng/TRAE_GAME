import type { LevelJson } from '../game/cards.ts';

/**
 * 预置关卡（AI 不可用时的无感回退）。
 * 数值设计均经过 BFS 验证：最少步数 = maxSteps（见 tests.ts）。
 */
export const FALLBACK_LEVELS: LevelJson[] = [
  {
    id: 'fb-rot',
    name: '练手卡关 · 旋转',
    key: [2, 2],
    lock: [-2, 2],
    forbidden: [{ x: 0.5, y: -2.5, w: 1, h: 1 }],
    maxSteps: 1,
    deck: [
      { cardId: 'rotate90', uses: 2 },
      { cardId: 'mirrorX', uses: 1 },
    ],
  },
  {
    id: 'fb-shear',
    name: '练手卡关 · 剪切',
    key: [0, 2],
    lock: [4, 2],
    forbidden: [{ x: -2, y: -3, w: 2, h: 1 }],
    maxSteps: 2,
    deck: [
      { cardId: 'shearX', uses: 3 },
      { cardId: 'rotate90', uses: 1 },
    ],
  },
  {
    id: 'fb-combo',
    name: '练手卡关 · 先剪后转',
    key: [2, 1],
    lock: [-1, 3],
    forbidden: [{ x: 0.5, y: 1.5, w: 1, h: 1 }],
    maxSteps: 2,
    deck: [
      { cardId: 'shearX', uses: 1 },
      { cardId: 'rotate90', uses: 1 },
      { cardId: 'projectX', uses: 1 },
      { cardId: 'mirrorX', uses: 1 },
    ],
  },
];

/** 5 条本地提示：前 3 条按失败原因，后 2 条为通用思路 */
export const FALLBACK_HINTS: string[] = [
  '钥匙落进红区了，先撤销一步，换种顺序绕开它。',
  '步数超限了，想想哪张卡是多余的，或直接重置。',
  '空间被压扁就回不去了，投影卡要谨慎，先撤销吧。',
  '先观察钥匙和锁的坐标差，再决定先剪切还是先旋转。',
  '矩阵从右往左生效：先打出的卡先作用于钥匙。',
];

export function pickFallbackHint(reason?: string | null): string {
  if (reason === 'forbidden') return FALLBACK_HINTS[0];
  if (reason === 'steps') return FALLBACK_HINTS[1];
  if (reason === 'projection') return FALLBACK_HINTS[2];
  return FALLBACK_HINTS[3 + Math.floor(Math.random() * 2)];
}

export function pickFallbackLevel(): LevelJson {
  return FALLBACK_LEVELS[Math.floor(Math.random() * FALLBACK_LEVELS.length)];
}
