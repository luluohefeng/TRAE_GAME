import type { DeckEntry } from '../game/state.ts';
import { renderLatex, toMatrixLatex } from './latex.ts';

export interface HandUI {
  /** 全局开关（动画/终局时冻结），与“次数用完”共同决定按钮是否可用 */
  setEnabled(enabled: boolean): void;
  /** 刷新每张卡的剩余次数；次数为 0 的按钮置灰 */
  setRemaining(remaining: number[]): void;
}

/**
 * 渲染手牌：按钮 = 矩阵公式 + 名称 + 剩余次数。
 * 公式只在创建按钮时渲染一次（矩阵是常量），之后仅更新次数文本。
 * 点击回调 onPlay(deck 下标)；动画/终局时由调用方 setEnabled(false) 冻结。
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
    btn.className = 'card-btn';
    btn.dataset.cardId = entry.card.id;
    const formula = document.createElement('span');
    formula.className = 'card-formula';
    renderLatex(toMatrixLatex(entry.card.matrix), formula);
    const name = document.createElement('span');
    name.className = 'card-name';
    name.textContent = entry.card.name;
    const count = document.createElement('span');
    count.className = 'card-count';
    count.textContent = `剩余 ×${remaining[i]}`;
    btn.appendChild(formula);
    btn.appendChild(name);
    btn.appendChild(count);
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
