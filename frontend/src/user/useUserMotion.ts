import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

const order: Record<string, number> = { home: 0, input: 1, confirm: 2, capture: 3, receipt: 4, profile: 1 };

// Animate the single mounted screen, never retain an outgoing form or camera.
export function useUserMotion(main: RefObject<HTMLElement>, screen: string, working: boolean, receiptId: string | undefined, transactionIds: string[], draftKey: string) {
  const previous = useRef(screen);
  const homeIntroduced = useRef(false);
  const celebrated = useRef(new Set<string>());
  const revealed = useRef(new Set<string>());
  const positions = useRef(new Map<string, DOMRect>());
  const transactionKey = transactionIds.join('|');
  useLayoutEffect(() => {
    const element = main.current;
    if (!element) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const animations: Animation[] = [];
    const play = (target: Element | null, frames: Keyframe[], duration: number, delay = 0) => {
      if (!target || reduced.matches || working) return;
      const animation = target.animate(frames, { duration, delay, fill: 'backwards', easing: 'cubic-bezier(.22,.8,.25,1)' });
      animations.push(animation);
      return animation;
    };
    const nextPositions = new Map<string, DOMRect>();
    element.querySelectorAll<HTMLElement>('[data-motion-key]').forEach(target => {
      const key = target.dataset.motionKey!;
      const next = target.getBoundingClientRect();
      nextPositions.set(key, next);
      const before = positions.current.get(key);
      const linked = (previous.current === 'input' && screen === 'confirm') || (previous.current === 'confirm' && screen === 'input');
      if (linked && before && next.width && next.height) {
        play(target, [
          { transformOrigin: 'top left', transform: `translate(${before.x - next.x}px, ${before.y - next.y}px) scale(${before.width / next.width}, ${before.height / next.height})` },
          { offset: .78, transformOrigin: 'top left', transform: `translate(${Math.max(-10, Math.min(10, (next.x - before.x) * .035))}px, ${Math.max(-12, Math.min(12, (next.y - before.y) * .035))}px) scale(1.025, 1.025)` },
          { transformOrigin: 'top left', transform: 'translate(0, 0) scale(1, 1)' },
        ], 480);
      }
    });
    const linkedScreen = (previous.current === 'input' && screen === 'confirm') || (previous.current === 'confirm' && screen === 'input');
    if (!linkedScreen && previous.current !== screen && screen !== 'capture' && previous.current !== 'capture' && !working) {
      const direction = order[screen] >= order[previous.current] ? 1 : -1;
      play(element, [{ opacity: 0, transform: `translateX(${direction * 18}px)` }, { opacity: 1, transform: 'translateX(0)' }], 220);
    }
    positions.current = nextPositions;
    previous.current = screen;
    if (screen === 'receipt' && receiptId && !working && !celebrated.current.has(receiptId)) {
      celebrated.current.add(receiptId);
      play(element.querySelector('.vf-user__success'), [{ transform: 'scale(.55) rotate(-10deg)', opacity: 0 }, { offset: .68, transform: 'scale(1.12) rotate(3deg)', opacity: 1 }, { offset: .86, transform: 'scale(.97) rotate(-1deg)' }, { transform: 'scale(1) rotate(0)' }], 540);
      element.querySelectorAll<HTMLElement>('[data-receipt-reveal]').forEach((target, index) => {
        play(target, [{ opacity: 0, transform: `translateY(${12 + index * 6}px)` }, { opacity: 1, transform: 'translateY(0)' }], 400, 100 + index * 90);
      });
      play(element.querySelector('.vf-user__success path'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 360);
    }
    if (screen === 'home' && !working) {
      if (!homeIntroduced.current) {
        let intro: Animation | undefined;
        element.querySelectorAll('.vf-user__account, .vf-user__section').forEach((target, index) => {
          intro = play(target, [{ opacity: 0, transform: 'translateY(28px) scale(.97)' }, { offset: .8, opacity: 1, transform: 'translateY(-3px) scale(1.005)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], 460, index * 55);
        });
        // StrictMode may cancel and replay setup; only a completed intro is consumed.
        if (intro) void intro.finished.then(() => { homeIntroduced.current = true; }, () => undefined);
        else if (reduced.matches) homeIntroduced.current = true;
      }
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
  }, [main, screen, working, receiptId, transactionKey, draftKey]);
  // Navigation may follow scrolling without a render: capture where the user sees it now.
  return () => {
    const current = new Map<string, DOMRect>();
    main.current?.querySelectorAll<HTMLElement>('[data-motion-key]').forEach(target => {
      current.set(target.dataset.motionKey!, target.getBoundingClientRect());
    });
    positions.current = current;
  };
}
