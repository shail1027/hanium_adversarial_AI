import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="admin-disclosure">
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <span className="admin-chevron" aria-hidden="true">›</span>{title}
    </button>
    <div id={id} className={`admin-disclosure-body ${open ? 'is-open' : ''}`} aria-hidden={!open} {...{ inert: open ? undefined : '' }}>
      <div><div className="admin-disclosure-content">{children}</div></div>
    </div>
  </div>;
}

// Native top-layer popover avoids clipping by tables and narrow card containers.
export function InfoTooltip({ text, label = '설명 보기' }: { text: string; label?: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  function cancelClose() { clearTimeout(closeTimer.current); }
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current && document.activeElement !== tip.current) tip.current?.hidePopover();
    }, 120);
  }
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const element = tip.current;
    const toggle = () => {
      const visible = element?.matches(':popover-open') ?? false;
      if (visible && trigger.current && element) positionTooltip(trigger.current, element);
      setOpen(visible);
    };
    element?.addEventListener('toggle', toggle);
    return () => element?.removeEventListener('toggle', toggle);
  }, []);
  function show() {
    cancelClose();
    if (!tip.current || !trigger.current) return;
    tip.current.showPopover();
    positionTooltip(trigger.current, tip.current);
  }
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      if (trigger.current && tip.current) positionTooltip(trigger.current, tip.current);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  }, [open]);
  return <span className="admin-help">
    <button ref={trigger} type="button" aria-label={label} aria-describedby={open ? id : undefined}
      {...{ popovertarget: id, popovertargetaction: 'show' }} onFocus={show} onBlur={event => { if (event.relatedTarget !== tip.current) tip.current?.hidePopover(); }}
      onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }}
      onPointerLeave={scheduleClose}>ⓘ</button>
    <div ref={tip} id={id} {...{ popover: 'auto' }} role="tooltip" tabIndex={0} onPointerEnter={cancelClose} onPointerLeave={scheduleClose} onBlur={event => { if (event.relatedTarget !== trigger.current) tip.current?.hidePopover(); }} className="admin-tooltip">{text}</div>
  </span>;
}

export function Skeleton({ cards = false }: { cards?: boolean }) {
  return <div className={cards ? 'admin-metrics admin-skeletons' : 'admin-skeletons'} role="status" aria-label="데이터를 불러오는 중입니다.">
    {Array.from({ length: 3 }, (_, index) => <div className={cards ? 'vf-stat-card' : 'admin-skeleton-row'} key={index} aria-hidden="true"><span className="admin-skeleton-line"/><span className="admin-skeleton-line"/></div>)}
  </div>;
}

function positionTooltip(trigger: HTMLElement, tip: HTMLElement) {
  const anchor = trigger.getBoundingClientRect();
  const box = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`;
  tip.style.top = `${Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - box.height - 8))}px`;
}
