import type { Vec2 } from './matrix.ts';
import type { Card, ForbiddenZone, Level } from './state.ts';

/** 卡牌库：id → 卡牌定义（矩阵为主，tex 留给后续 KaTeX 阶段） */
export const CARD_LIBRARY: Record<string, Card> = {
  rotate90: {
    id: 'rotate90',
    name: '旋转 90°',
    matrix: [[0, -1], [1, 0]],
    symbol: 'R',
  },
  shearX: {
    id: 'shearX',
    name: '水平剪切',
    matrix: [[1, 1], [0, 1]],
    symbol: 'S',
  },
  projectX: {
    id: 'projectX',
    name: 'X 轴投影',
    matrix: [[1, 0], [0, 0]],
    symbol: 'P',
  },
  mirrorX: {
    id: 'mirrorX',
    name: 'X 轴镜像',
    matrix: [[1, 0], [0, -1]],
    symbol: 'M',
  },
  mirrorY: {
    id: 'mirrorY',
    name: 'Y 轴镜像',
    matrix: [[-1, 0], [0, 1]],
    symbol: 'M',
  },
  rotate180: {
    id: 'rotate180',
    name: '旋转 180°',
    matrix: [[-1, 0], [0, -1]],
    symbol: 'R',
  },
  swapXY: {
    id: 'swapXY',
    name: '对角翻转',
    matrix: [[0, 1], [1, 0]],
    symbol: 'F',
  },
};

/** 关卡 JSON 的原始结构（deck 用 cardId 引用卡库） */
export interface LevelJson {
  id: string;
  name: string;
  key: Vec2;
  lock: Vec2;
  forbidden: ForbiddenZone[];
  maxSteps: number;
  deck: { cardId: string; uses: number }[];
}

/** JSON → Level：解析 cardId；未知卡牌或次数非正直接报错（关卡必须预置且可验证） */
export function loadLevel(json: LevelJson): Level {
  return {
    id: json.id,
    name: json.name,
    key: json.key,
    lock: json.lock,
    forbidden: json.forbidden,
    maxSteps: json.maxSteps,
    deck: json.deck.map((d) => {
      const card = CARD_LIBRARY[d.cardId];
      if (!card) throw new Error(`未知卡牌：${d.cardId}（关卡 ${json.id}）`);
      if (!Number.isInteger(d.uses) || d.uses <= 0) {
        throw new Error(`卡牌次数必须为正整数：${d.cardId}（关卡 ${json.id}）`);
      }
      return { card, uses: d.uses };
    }),
  };
}
