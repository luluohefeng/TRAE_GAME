/**
 * 演示模式：约 90 秒自动走一遍核心玩法（旋转→剪切→反序失败→自定义矩阵→投影警告）。
 * 纯数据 + 驱动循环，所有副作用经 DemoContext 注入，不直接碰游戏逻辑；
 * 播放期间由 main.ts 锁定全部手动输入，随时可取消。
 */

export type DemoAction =
  | { kind: 'load'; index: number } // 切换关卡
  | { kind: 'play'; deckIndex: number } // 打出预设卡（等待动画结束）
  | { kind: 'fill'; values: [number, number, number, number] } // 填入工坊输入（只预览，不打出）
  | { kind: 'playCustom' } // 打出当前输入的自定义矩阵（等待动画结束）
  | { kind: 'reset' }; // 重置当前关

export interface DemoStep {
  /** 本步解说字幕 */
  caption: string;
  action: DemoAction;
  /** 动作与动画完成后停留秒数 */
  waitAfter: number;
}

/** 总停留 ~83s + 10 次出牌动画 ~3s ≈ 86s，约 90 秒 */
export const DEMO_SCRIPT: DemoStep[] = [
  { caption: '演示开始 · 全程约 90 秒，无需操作', action: { kind: 'load', index: 0 }, waitAfter: 5 },
  { caption: '第 1 关：打出「旋转90°」，钥匙一步转到位', action: { kind: 'play', deckIndex: 0 }, waitAfter: 5.5 },
  { caption: '第 2 关：用「水平剪切」把钥匙水平推过去', action: { kind: 'load', index: 1 }, waitAfter: 4 },
  { caption: '第 2 关 · 第一次剪切：x 增加 y 的值', action: { kind: 'play', deckIndex: 0 }, waitAfter: 3.5 },
  { caption: '第 2 关 · 第二次剪切：对齐锁，开门', action: { kind: 'play', deckIndex: 0 }, waitAfter: 5.5 },
  { caption: '第 3 关：故意用错误顺序——先旋转再剪切', action: { kind: 'load', index: 2 }, waitAfter: 5 },
  { caption: '错误顺序 1/2：先打出「旋转90°」', action: { kind: 'play', deckIndex: 1 }, waitAfter: 3.5 },
  { caption: '错误顺序 2/2：再剪切——钥匙落进红色禁区', action: { kind: 'play', deckIndex: 0 }, waitAfter: 7 },
  { caption: '重置本关，换正确顺序：先剪后转', action: { kind: 'reset' }, waitAfter: 4 },
  { caption: '正确顺序 1/2：先打出「水平剪切」', action: { kind: 'play', deckIndex: 0 }, waitAfter: 3.5 },
  { caption: '正确顺序 2/2：再旋转——三关全部通过', action: { kind: 'play', deckIndex: 1 }, waitAfter: 6 },
  { caption: '进入矩阵工坊：试试自定义 2×2 矩阵', action: { kind: 'load', index: 3 }, waitAfter: 4 },
  { caption: '输入 [[1,1],[0,1]]：预览公式与空间虚影', action: { kind: 'fill', values: [1, 1, 0, 1] }, waitAfter: 5 },
  { caption: '打出自定义矩阵（消耗 2 步）：空间被斜切', action: { kind: 'playCustom' }, waitAfter: 5.5 },
  { caption: '再输入投影矩阵 [[1,0],[0,0]]：出现不可逆警告', action: { kind: 'fill', values: [1, 0, 0, 0] }, waitAfter: 5.5 },
  { caption: '强行打出：投影压线，det(A)=0，判定失败', action: { kind: 'playCustom' }, waitAfter: 7.5 },
  { caption: '演示结束，感谢观看！现在可自由操作', action: { kind: 'load', index: 0 }, waitAfter: 3 },
];

export interface DemoContext {
  caption(text: string): void;
  load(index: number): void;
  play(deckIndex: number): Promise<void>;
  fill(values: [number, number, number, number]): void;
  playCustom(): Promise<void>;
  reset(): void;
  sleep(ms: number): Promise<void>;
  cancelled(): boolean;
}

/** 顺序执行脚本；cancelled() 为 true 时在下一步前停止 */
export async function runDemo(ctx: DemoContext): Promise<void> {
  for (const step of DEMO_SCRIPT) {
    if (ctx.cancelled()) return;
    ctx.caption(step.caption);
    const a = step.action;
    if (a.kind === 'load') ctx.load(a.index);
    else if (a.kind === 'play') await ctx.play(a.deckIndex);
    else if (a.kind === 'fill') ctx.fill(a.values);
    else if (a.kind === 'playCustom') await ctx.playCustom();
    else ctx.reset();
    await ctx.sleep(step.waitAfter * 1000);
  }
}
