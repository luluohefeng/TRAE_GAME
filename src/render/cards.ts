import type { DeckEntry } from '../game/state.ts';
import { renderLatex, toMatrixLatex } from './latex.ts';

export interface HandUI {
  /** 全局开关（动画/终局时冻结），与“次数用完”共同决定按钮是否可用 */
  setEnabled(enabled: boolean): void;
  /** 刷新每张卡的剩余次数；次数为 0 的按钮置灰 */
  setRemaining(remaining: number[]): void;
}

/**
 * 卡面操作图标（内联 SVG，currentColor 跟随卡面文字色）。
 * 仅展示层映射，不改动 CARD_LIBRARY 数据。
 */
const CARD_ICONS: Record<string, string> = {
  rotate90:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
  shearX:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h10.5l4.5 6H8.5z"/><path d="M4 9.5h3.5"/></svg>',
  projectX:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19h16"/><path d="M8 4v8"/><path d="m5.5 9.5 2.5 2.5 2.5-2.5"/><path d="M16 4v8"/><path d="m13.5 9.5 2.5 2.5 2.5-2.5"/></svg>',
  mirrorX:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16" stroke-dasharray="3 3"/><path d="m8 5 4 4 4-4"/><path d="m8 19 4-4 4 4"/></svg>',
  mirrorY:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16" stroke-dasharray="3 3"/><path d="M9 7H5v4"/><path d="M15 7h4v4"/></svg>',
};

/** 未知/自定义卡（如矩阵工坊的 custom 卡）的通用图标：铅笔，避免误显示为旋转图标 */
const CARD_ICON_GENERIC =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3l4 4L8 20H4v-4L17 3z"/></svg>';

/** 卡面一行动效说明。仅展示层映射。 */
const CARD_DESCS: Record<string, string> = {
  rotate90: '逆时针旋转 90°',
  shearX: 'x 加上 y，水平推挤',
  projectX: '压到 X 轴（不可逆）',
  mirrorX: '沿 X 轴上下翻转',
  mirrorY: '沿 Y 轴左右翻转',
};

/**
 * 渲染手牌：卡面 = 符号徽章 + 操作图标 + 名称 + 矩阵公式 + 效果说明 + 剩余次数。
 * 公式只在创建按钮时渲染一次（矩阵是常量），之后仅更新次数文本。
 * 点击回调 onPlay(deck 下标)；动画/终局时由调用方 setEnabled(false) 冻结。
 * 按钮始终是 .hand 的直接子元素（键盘快捷键 1-3 依赖该结构）。
 */
export function renderHand(
  container: HTMLElement,
  deck: DeckEntry[],
  onPlay: (index: number) => void,
): HandUI {
  container.innerHTML = '';
  let enabled = true;
  let remaining = deck.map((e) => e.uses);
  const buttons: HTMLButtonElement[] = [];
  const countEls: HTMLSpanElement[] = [];

  const refresh = (): void => {
    buttons.forEach((b, i) => {
      b.disabled = !enabled || remaining[i] <= 0;
    });
  };

  deck.forEach((entry, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card-btn';
    btn.dataset.cardId = entry.card.id;

    const symbol = document.createElement('span');
    symbol.className = 'card-symbol';
    symbol.textContent = entry.card.symbol ?? 'A';

    const icon = document.createElement('span');
    icon.className = 'card-icon';
    icon.innerHTML = CARD_ICONS[entry.card.id] ?? CARD_ICON_GENERIC;

    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = entry.card.name;

    const formula = document.createElement('span');
    formula.className = 'card-formula';
    renderLatex(toMatrixLatex(entry.card.matrix), formula);

    const desc = document.createElement('span');
    desc.className = 'card-desc';
    desc.textContent = CARD_DESCS[entry.card.id] ?? '';

    const count = document.createElement('span');
    count.className = 'card-count';
    count.textContent = `剩余 ×${remaining[i]}`;

    btn.append(symbol, icon, name, formula, desc, count);
    btn.addEventListener('click', () => onPlay(i));
    container.appendChild(btn);
    buttons.push(btn);
    countEls.push(count);
  });
  refresh();

  return {
    setEnabled(value: boolean) {
      enabled = value;
      refresh();
    },
    setRemaining(value: number[]) {
      remaining = value.slice();
      countEls.forEach((el, i) => {
        el.textContent = `剩余 ×${remaining[i]}`;
      });
      refresh();
    },
  };
}
