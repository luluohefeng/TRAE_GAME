import { IDENTITY, apply, det, isInvertible, multiply, type Mat2, type Vec2 } from './matrix.ts';
import { applyCard, applyCustomCard, createGame, undo, type Card, type Level } from './state.ts';
import { evaluate } from './judge.ts';
import { FALLBACK_HINTS, FALLBACK_LEVELS, pickFallbackHint } from '../ai/fallback.ts';
import { sanitizeHint } from '../ai/client.ts';
import { bfsMinSteps, isValidLevelJson } from './validate.ts';
import { DIFFICULTY_RULES, generateRandomLevel, type Difficulty } from './generator.ts';
import {
  buildCampaign,
  campaignTierLabel,
  CAMPAIGN_LENGTH,
  CAMPAIGN_START,
} from './campaign.ts';
import { DEMO_SCRIPT } from '../demo.ts';
import level1Json from '../levels/level1.json' with { type: 'json' };
import level2Json from '../levels/level2.json' with { type: 'json' };
import level3Json from '../levels/level3.json' with { type: 'json' };
import workshopJson from '../levels/workshop.json' with { type: 'json' };

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}
function vecNear(a: Vec2, b: Vec2): boolean {
  return near(a[0], b[0]) && near(a[1], b[1]);
}
function matNear(A: Mat2, B: Mat2): boolean {
  return (
    near(A[0][0], B[0][0]) && near(A[0][1], B[0][1]) && near(A[1][0], B[1][0]) && near(A[1][1], B[1][1])
  );
}

let passed = 0;
let failed = 0;
function test(name: string, fn: () => boolean): void {
  let ok = false;
  try {
    ok = fn();
  } catch (e) {
    console.error(`FAIL ${name}（异常）`, e);
  }
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

const ROT90: Mat2 = [[0, -1], [1, 0]];
const SHEAR: Mat2 = [[1, 1], [0, 1]];
const PROJECT: Mat2 = [[1, 0], [0, 0]];

function cardOf(id: string, matrix: Mat2): Card {
  return { id, name: id, matrix };
}
function levelOf(overrides: Partial<Level> = {}): Level {
  return {
    id: 'test',
    name: 'test',
    key: [1, 0],
    lock: [-1, 0],
    forbidden: [],
    maxSteps: 5,
    deck: [{ card: cardOf('rot90', ROT90), uses: 2 }],
    ...overrides,
  };
}

// 1. 旋转 90° 四次回到原点
test('旋转90°四次回原点', () => {
  let M: Mat2 = IDENTITY;
  for (let i = 0; i < 4; i++) M = multiply(ROT90, M);
  return matNear(M, IDENTITY) && vecNear(apply(M, [1, 0]), [1, 0]);
});

// 2. 剪切后点位正确：x' = x + y, y' = y
test('剪切后点位正确', () => {
  return vecNear(apply(SHEAR, [2, 3]), [5, 3]);
});

// 3. det 为 0 不可逆
test('det为0不可逆', () => {
  return det(PROJECT) === 0 && !isInvertible(PROJECT) && isInvertible(ROT90);
});

// 4. 撤销恢复矩阵与剩余次数：rot90 → shear → undo，M 回 rot90，次数全部返还
test('撤销恢复矩阵与次数', () => {
  const s = createGame(
    levelOf({
      deck: [
        { card: cardOf('rot90', ROT90), uses: 2 },
        { card: cardOf('shear', SHEAR), uses: 1 },
      ],
    }),
  );
  applyCard(s, 0);
  applyCard(s, 1);
  undo(s);
  return (
    matNear(s.M, ROT90) &&
    s.stepsUsed === 1 &&
    s.stack.length === 1 &&
    s.remaining[0] === 1 &&
    s.remaining[1] === 1
  );
});

// 5. 胜利判定（锁固定不随 M 变换）：rotate90 后 key [2,2] → [-2,2]，与锁重合
test('胜利判定', () => {
  const s = createGame(levelOf({ key: [2, 2], lock: [-2, 2] }));
  applyCard(s, 0);
  return s.status === 'won';
});

// 6. 次数用完不可再出：uses=1，第二次 applyCard 应被忽略
test('次数用完禁止再出', () => {
  const s = createGame(
    levelOf({
      key: [5, 5],
      lock: [0, 0],
      maxSteps: 9,
      deck: [{ card: cardOf('rot90', ROT90), uses: 1 }],
    }),
  );
  applyCard(s, 0); // [5,5] → [-5,5]，未胜
  applyCard(s, 0); // 次数为 0，应被忽略
  return s.stack.length === 1 && s.stepsUsed === 1 && s.remaining[0] === 0 && s.status === 'playing';
});

// 7. 投影后压线判负：projectX 后 det = 0 且未达锁，立即失败
test('投影后压线判负', () => {
  const s = createGame(
    levelOf({ key: [2, 1], lock: [9, 9], deck: [{ card: cardOf('projectX', PROJECT), uses: 1 }] }),
  );
  applyCard(s, 0);
  return s.status === 'lost' && evaluate(s).reason === 'projection';
});

// 8. 固定禁区与出牌顺序（第 3 关核心）：先剪后转胜，先转后剪进禁区
test('固定禁区：反序进禁区、正序通关', () => {
  const mk = (): ReturnType<typeof createGame> =>
    createGame(
      levelOf({
        key: [2, 1],
        lock: [-1, 3],
        forbidden: [{ x: 0.5, y: 1.5, w: 1, h: 1 }],
        maxSteps: 2,
        deck: [
          { card: cardOf('shearX', SHEAR), uses: 1 },
          { card: cardOf('rot90', ROT90), uses: 1 },
        ],
      }),
    );
  const wrong = mk();
  applyCard(wrong, 1); // 旋转：[2,1] → [-1,2]
  applyCard(wrong, 0); // 剪切：[-1,2] → [1,2]，落入禁区
  const wrongEval = evaluate(wrong);
  const right = mk();
  applyCard(right, 0); // 剪切：[2,1] → [3,1]
  applyCard(right, 1); // 旋转：[3,1] → [-1,3]，与锁重合
  return (
    wrong.status === 'lost' &&
    wrongEval.reason === 'forbidden' &&
    wrongEval.zoneIndex === 0 &&
    right.status === 'won'
  );
});

// 9. 自定义矩阵卡：消耗 2 步、不占预设次数，撤销后步数归零、次数不变
test('自定义矩阵消耗2步且可撤销', () => {
  const s = createGame(levelOf({ key: [5, 5], lock: [0, 0], maxSteps: 9 }));
  applyCustomCard(s, SHEAR);
  const afterPlay =
    s.stepsUsed === 2 && matNear(s.M, SHEAR) && s.remaining[0] === 2 && s.status === 'playing';
  undo(s);
  return afterPlay && s.stepsUsed === 0 && matNear(s.M, IDENTITY) && s.remaining[0] === 2;
});

// 10. fallback 预置关全部通过 Schema + BFS 校验（最少步数 = maxSteps）
test('fallback关卡全部通过BFS校验', () => {
  return FALLBACK_LEVELS.every((l) => isValidLevelJson(l) && bfsMinSteps(l) === l.maxSteps);
});

// 11. 非法关卡被丢弃：BFS 步数不等 / Schema 非法 / 不可解
test('非法关卡被丢弃', () => {
  const bad1 = JSON.parse(JSON.stringify(FALLBACK_LEVELS[0])) as (typeof FALLBACK_LEVELS)[number];
  bad1.maxSteps = bad1.maxSteps + 1; // Schema 合法但最少步数 ≠ maxSteps
  const bad2 = { id: 'x', name: 'x' }; // Schema 非法
  const bad3 = JSON.parse(JSON.stringify(FALLBACK_LEVELS[0])) as (typeof FALLBACK_LEVELS)[number];
  bad3.lock = [9, 9]; // 不可解
  return (
    isValidLevelJson(bad1) &&
    bfsMinSteps(bad1) !== bad1.maxSteps &&
    !isValidLevelJson(bad2) &&
    isValidLevelJson(bad3) &&
    bfsMinSteps(bad3) === null
  );
});

// 12. 提示校验：单句、单行、30 字内；本地提示全部合格
test('提示校验：单句30字内', () => {
  const ok = sanitizeHint('  先观察坐标，再决定出牌顺序。  ') !== null;
  const tooLong = sanitizeHint('很'.repeat(31)) === null;
  const multiLine = sanitizeHint('第一行\n第二行') === null;
  const hintsOk = FALLBACK_HINTS.every((h) => [...h].length <= 30 && !/[\r\n]/.test(h));
  const picked = [...pickFallbackHint('forbidden')].length <= 30;
  return ok && tooLong && multiLine && hintsOk && picked;
});

// 13. 演示脚本结构：总时长约 90 秒、动作种类齐全、出牌下标对当前关卡合法、字幕非空
test('演示脚本结构合法且约90秒', () => {
  const decks = [level1Json, level2Json, level3Json, workshopJson].map((j) => j.deck.length);
  const totalWait = DEMO_SCRIPT.reduce((s, x) => s + x.waitAfter, 0);
  const kinds = new Set(DEMO_SCRIPT.map((x) => x.action.kind));
  let current = 0;
  const indicesOk = DEMO_SCRIPT.every((x) => {
    if (x.action.kind === 'load') {
      current = x.action.index;
      return current >= -1 && current < decks.length; // -1 = 造卡工坊哨兵
    }
    if (x.action.kind === 'play') {
      return x.action.deckIndex >= 0 && x.action.deckIndex < decks[current];
    }
    return true;
  });
  const captionsOk = DEMO_SCRIPT.every((x) => x.caption.length > 0 && [...x.caption].length <= 40);
  return (
    totalWait >= 60 &&
    totalWait <= 92 &&
    kinds.has('load') &&
    kinds.has('play') &&
    kinds.has('fill') &&
    kinds.has('playCustom') &&
    kinds.has('reset') &&
    indicesOk &&
    captionsOk
  );
});

// 14. 随机关卡：各难度连续生成 4 关，Schema 合法、BFS 最少步数 = maxSteps 且落在难度区间、初始钥匙不在禁区
test('随机关卡各难度可解且符合区间', () => {
  const tiers: Difficulty[] = ['easy', 'normal', 'hard'];
  for (const d of tiers) {
    const rule = DIFFICULTY_RULES[d];
    for (let i = 0; i < 4; i++) {
      const lvl = generateRandomLevel(d);
      if (!isValidLevelJson(lvl)) return false;
      if (bfsMinSteps(lvl) !== lvl.maxSteps) return false;
      if (lvl.maxSteps < rule.minSteps || lvl.maxSteps > rule.maxSteps) return false;
      const [kx, ky] = lvl.key;
      const inZone = lvl.forbidden.some(
        (z) => kx >= z.x && kx <= z.x + z.w && ky >= z.y && ky <= z.y + z.h,
      );
      if (inZone) return false;
    }
  }
  return true;
});

// 15. 战役：37 关确定性生成、全部通过 Schema + BFS 校验、难度标签覆盖全档
test('战役关卡全部可解且确定性生成', () => {
  const a = buildCampaign();
  const b = buildCampaign();
  if (a.length !== CAMPAIGN_LENGTH - CAMPAIGN_START) return false;
  if (a.some((l, i) => JSON.stringify(l) !== JSON.stringify(b[i]))) return false; // 两次生成完全一致
  return a.every(
    (l, i) =>
      isValidLevelJson(l) &&
      bfsMinSteps(l) === l.maxSteps &&
      campaignTierLabel(i + CAMPAIGN_START).length > 0,
  );
});

console.log(`测试结果：${passed} 通过，${failed} 失败`);
if (failed === 0) {
  console.log('测试全部通过');
}
