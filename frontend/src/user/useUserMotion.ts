import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const order: Record<string, number> = { home: 0, input: 1, confirm: 2, capture: 3, receipt: 4, profile: 1 };

// Animate the single mounted screen, never retain an outgoing form or camera.
export function useUserMotion(main: RefObject<HTMLElement>, screen: string, working: boolean, receiptId: string | undefined, transactionIds: string[]) {
  const previous = useRef(screen);
  const celebrated = useRef(new Set<string>());
  const revealed = useRef(new Set<string>());
  const transactionKey = transactionIds.join('|');
  useLayoutEffect(() => {
    const element = main.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations: Animation[] = [];
    const play = (target: Element | null, frames: Keyframe[], duration: number) => {
      if (target && !reduced.matches && !working) animations.push(target.animate(frames, { duration, easing: 'cubic-bezier(.22,.8,.25,1)' }));
    };
    if (previous.current !== screen && screen !== 'capture' && previous.current !== 'capture' && !working) {
      const direction = order[screen] >= order[previous.current] ? 1 : -1;
      play(element, [{ opacity: 0, transform: `translateX(${direction * 18}px)` }, { opacity: 1, transform: 'translateX(0)' }], 220);
    }
    previous.current = screen;
    if (screen === 'receipt' && receiptId && !working && !celebrated.current.has(receiptId)) {
      celebrated.current.add(receiptId);
      play(element.querySelector('.vf-user__success'), [{ transform: 'scale(.88)', opacity: .6 }, { transform: 'scale(1)', opacity: 1 }], 240);
      play(element.querySelector('.vf-user__success path'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 360);
    }
    if (screen === 'home' && !working) {
      element.querySelectorAll<HTMLElement>('[data-transaction-id]').forEach(row => {
        const id = row.dataset.transactionId!;
        if (!revealed.current.has(id)) {
          revealed.current.add(id);
          play(row, [{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], 240);
        }
      });
    }
    const cancel = () => animations.forEach(animation => animation.cancel());
    // Changing the OS preference immediately stops motion, without replaying it later.
    reduced.addEventListener('change', cancel);
    return () => { cancel(); reduced.removeEventListener('change', cancel); };
  }, [main, screen, working, receiptId, transactionKey]);
}
