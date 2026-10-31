export {};
// Header interactions, rebuilt on native elements after the reference site's React menus.
// Without this script the language menu and phone menu still open as plain <details>,
// and a submenu panel shows while its button is hovered or focused.
const header = document.querySelector<HTMLElement>('[data-site-header]')!;
const desktop = matchMedia('(min-width: 840px)');
const isTouch = (event: PointerEvent) => event.pointerType === 'touch';

/* Desktop submenus: the WAI-ARIA disclosure pattern, timed like the reference site. */
const HOVER_OPEN_DELAY_MS = 100;
const HOVER_CLOSE_DELAY_MS = 150;
const list = header.querySelector<HTMLUListElement>('[data-header-nav]');
if (list) {
  const triggers = [...list.querySelectorAll<HTMLButtonElement>('[data-nav-trigger]')];
  const panel = (key: string) => document.getElementById(`header-nav-panel-${key}`)!;
  let openKey: string | null = null;
  let openedByPointer = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = () => clearTimeout(timer);
  const focusInPanel = () => Boolean(document.activeElement?.closest('[data-nav-panel]'));
  const render = () => {
    for (const trigger of triggers) {
      const open = trigger.dataset.navTrigger === openKey;
      trigger.setAttribute('aria-expanded', String(open));
      panel(trigger.dataset.navTrigger!).hidden = !open;
    }
  };
  const open = (key: string, byPointer: boolean) => {
    openKey = key;
    openedByPointer = byPointer;
    render();
  };
  const close = () => {
    clearTimer();
    openKey = null;
    render();
  };
  const openAndFocusFirstLink = (key: string) => {
    clearTimer();
    open(key, false);
    panel(key).querySelector('a')?.focus();
  };
  render();
  header.dataset.navEnhanced = '';

  for (const item of list.querySelectorAll<HTMLElement>('[data-nav-menu]')) {
    const key = item.dataset.navMenu!;
    item.addEventListener('pointerenter', (event) => {
      if (isTouch(event)) return;
      clearTimer();
      if (openKey === key || focusInPanel()) return;
      // With another panel already open, switch at once instead of waiting.
      if (openKey !== null) open(key, true);
      else timer = setTimeout(() => open(key, true), HOVER_OPEN_DELAY_MS);
    });
    item.addEventListener('pointerleave', (event) => {
      if (isTouch(event)) return;
      clearTimer();
      if (openKey !== null)
        timer = setTimeout(() => {
          if (!focusInPanel()) close();
        }, HOVER_CLOSE_DELAY_MS);
    });
  }
  for (const trigger of triggers) {
    const key = trigger.dataset.navTrigger!;
    trigger.addEventListener('click', (event) => {
      clearTimer();
      // detail 0 is a keyboard Enter or Space: open and move focus to the first link.
      if (event.detail === 0) {
        if (openKey === key) close();
        else openAndFocusFirstLink(key);
        return;
      }
      // A click just after a hover opened the panel keeps it open; the next one closes it.
      if (openKey === key && openedByPointer) openedByPointer = false;
      else if (openKey === key) close();
      else open(key, false);
    });
  }
  const moveFocus = (items: HTMLElement[], current: HTMLElement, key: string) => {
    const index = items.indexOf(current);
    const last = items.length - 1;
    const next = (
      {
        ArrowDown: Math.min(index + 1, last),
        ArrowRight: Math.min(index + 1, last),
        ArrowUp: Math.max(index - 1, 0),
        ArrowLeft: Math.max(index - 1, 0),
        Home: 0,
        End: last,
      } as Record<string, number>
    )[key];
    if (index < 0 || next === undefined) return false;
    items[next]?.focus();
    return true;
  };
  list.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement;
    if (event.key === 'Escape' && openKey !== null) {
      event.preventDefault();
      const key = openKey;
      close();
      list.querySelector<HTMLElement>(`[data-nav-trigger="${key}"]`)?.focus();
      return;
    }
    if (event.key === 'ArrowDown' && target.dataset.navTrigger) {
      event.preventDefault();
      openAndFocusFirstLink(target.dataset.navTrigger);
      return;
    }
    // Inside a panel Up/Down/Home/End walk its links; on the top row Left/Right walk the items.
    const inPanel = target.closest<HTMLElement>('[data-nav-panel]');
    const sideways = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
    const items = inPanel
      ? sideways
        ? []
        : [...inPanel.querySelectorAll<HTMLElement>('a')]
      : sideways
        ? [...list.querySelectorAll<HTMLElement>(':scope > li > :is(a, button)')]
        : [];
    if (moveFocus(items, target, event.key)) event.preventDefault();
  });
  list.addEventListener('focusin', (event) => {
    if ((event.target as Element).closest('[data-nav-trigger], [data-nav-panel]')) clearTimer();
  });
  // Focus leaving the navigation closes the panel so it never covers what comes next.
  list.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !list.contains(next)) close();
  });
  list.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-nav-panel] a')) close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (openKey !== null && !list.contains(event.target as Node)) close();
  });
  desktop.addEventListener('change', close);
}

/* Language menu: a <details> that also opens on hover and closes on Escape or outside. */
const LANGUAGE_CLOSE_DELAY_MS = 80;
for (const menu of header.querySelectorAll<HTMLDetailsElement>('[data-language-menu]')) {
  const summary = menu.querySelector('summary')!;
  const options = () => [...menu.querySelectorAll<HTMLElement>('a')];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let openedByPointer = false;
  menu.addEventListener('pointerenter', (event) => {
    if (isTouch(event)) return;
    clearTimeout(timer);
    if (!menu.open) {
      openedByPointer = true;
      menu.open = true;
    }
  });
  menu.addEventListener('pointerleave', (event) => {
    if (isTouch(event)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!menu.contains(document.activeElement) || openedByPointer) menu.open = false;
    }, LANGUAGE_CLOSE_DELAY_MS);
  });
  summary.addEventListener('click', (event) => {
    clearTimeout(timer);
    // The click that follows a hover-open keeps the menu open instead of toggling it shut.
    if (menu.open && openedByPointer && event.detail !== 0) {
      event.preventDefault();
      openedByPointer = false;
      return;
    }
    openedByPointer = false;
  });
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      menu.open = false;
      summary.focus();
      return;
    }
    const items = options();
    if (!items.length) return;
    if (event.key === 'ArrowDown' && event.target === summary) {
      event.preventDefault();
      menu.open = true;
      items[0]!.focus();
      return;
    }
    const index = items.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    const next = (
      {
        ArrowDown: Math.min(index + 1, items.length - 1),
        ArrowUp: Math.max(index - 1, 0),
        Home: 0,
        End: items.length - 1,
      } as Record<string, number>
    )[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[next]!.focus();
  });
  menu.addEventListener('focusout', (event) => {
    const next = event.relatedTarget as Node | null;
    if (next && !menu.contains(next)) menu.open = false;
  });
  document.addEventListener('pointerdown', (event) => {
    if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
  });
  // A page restored from the back/forward cache comes back with the menu closed.
  addEventListener('pageshow', () => (menu.open = false));
}

/* Phone menu: the fallback <details> becomes a button that opens a modal side drawer. */
const fallback = header.querySelector<HTMLDetailsElement>('[data-mobile-fallback]');
const drawer = header.querySelector<HTMLDialogElement>('[data-mobile-drawer]');
const opener = header.querySelector<HTMLButtonElement>('[data-mobile-open]');
const body = header.querySelector<HTMLElement>('[data-mobile-drawer-body]');
const navigation = header.querySelector<HTMLElement>('#mobile-navigation');
if (fallback && drawer && body && opener && navigation && typeof drawer.showModal === 'function') {
  body.append(navigation);
  fallback.hidden = true;
  opener.hidden = false;
  const root = document.documentElement;
  let closing: ReturnType<typeof setTimeout> | undefined;
  const finishClose = () => {
    clearTimeout(closing);
    closing = undefined;
    drawer.removeEventListener('transitionend', onTransitionEnd);
    delete drawer.dataset.closing;
    if (drawer.open) drawer.close();
  };
  const onTransitionEnd = (event: TransitionEvent) => {
    if (event.target === drawer && event.propertyName === 'translate') finishClose();
  };
  // Slide out first, then close: browsers without discrete transitions (Firefox) would
  // otherwise drop the drawer at once instead of animating it away.
  const closeDrawer = () => {
    if (!drawer.open || closing !== undefined) return;
    drawer.dataset.closing = '';
    drawer.addEventListener('transitionend', onTransitionEnd);
    const duration = parseFloat(getComputedStyle(drawer).transitionDuration) || 0;
    closing = setTimeout(finishClose, duration * 1000 + 50);
  };
  opener.addEventListener('click', () => {
    if (closing !== undefined) finishClose();
    drawer.showModal();
    opener.setAttribute('aria-expanded', 'true');
    root.classList.add('drawer-open');
  });
  drawer.addEventListener('close', () => {
    opener.setAttribute('aria-expanded', 'false');
    root.classList.remove('drawer-open');
  });
  header.querySelector('[data-mobile-close]')?.addEventListener('click', closeDrawer);
  // Escape normally closes a modal dialog at once; cancelling it lets the drawer slide out.
  // Tab wraps around inside the drawer instead of leaving for the browser's own controls.
  drawer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll<HTMLElement>('a[href], button, summary')].filter(
      (element) => element.checkVisibility(),
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  drawer.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDrawer();
  });
  // A press on the dimmed page outside the panel lands on the dialog itself.
  drawer.addEventListener('click', (event) => {
    if (event.target === drawer) closeDrawer();
  });
  // Close before the link's own handlers run, so one that keeps the visitor on this page
  // (a language switch waiting on an inquiry) can move focus out of the drawer.
  drawer.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element).closest('a')) finishClose();
    },
    true,
  );
  desktop.addEventListener('change', (event) => {
    if (event.matches) finishClose();
  });
  addEventListener('pageshow', finishClose);
}
