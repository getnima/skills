/** Small building blocks of the host page: buttons, dialogs, the switch, the toast. */
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

import type { ComponentChildren, JSX } from 'preact';

export interface BtnProps {
  readonly label: ComponentChildren;
  readonly icon?: string;
  /** Keyboard shortcut shown on the button. */
  readonly kbd?: string;
  readonly tone?: 'primary' | 'plain' | 'danger' | 'ghost';
  readonly disabled?: boolean;
  readonly title?: string;
  readonly class?: string;
  readonly testId?: string;
  /**
   * A risky action waiting for its second press: this question floats above the button.
   * The button keeps its label and its size, so the second press lands on the same spot.
   */
  readonly armed?: string | null;
  onClick(): void;
}

export function Btn(props: BtnProps): JSX.Element {
  return (
    <button
      type="button"
      class={`hs-btn hs-btn--${props.tone ?? 'plain'} ${props.class ?? ''} ${typeof props.armed === 'string' ? 'is-armed' : ''}`}
      disabled={props.disabled}
      title={props.title}
      data-testid={props.testId}
      onClick={(e) => {
        e.stopPropagation();
        (e.currentTarget as HTMLButtonElement).blur();
        // the 2nd (3rd…) click of a double click is not a decision: after the 1st one changed the
        // screen it would hit whatever button is under the pointer now (continue → next game)
        if (e.detail > 1) return;
        props.onClick();
      }}
    >
      {props.icon !== undefined ? <span class="hs-btn-icon">{props.icon}</span> : null}
      <span class="hs-btn-label">{props.label}</span>
      {props.kbd !== undefined ? <kbd class="hs-kbd">{props.kbd}</kbd> : null}
      {typeof props.armed === 'string' ? (
        <span class="hs-btn-armed" role="status" data-testid="armed-hint">
          {props.armed}
        </span>
      ) : null}
    </button>
  );
}

export interface ModalProps {
  readonly title: ComponentChildren;
  readonly children?: ComponentChildren;
  readonly wide?: boolean;
  readonly testId?: string;
  onClose(): void;
}

export function Modal(props: ModalProps): JSX.Element {
  // layout effect: Escape works from the very frame the dialog appears
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div class="hs-modal-back" onClick={props.onClose} data-testid={props.testId}>
      <div class={`hs-modal ${props.wide === true ? 'hs-modal--wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog">
        <header class="hs-modal-head">
          <h2>{props.title}</h2>
          <button type="button" class="hs-x" onClick={props.onClose} aria-label="סגירה">
            ✕
          </button>
        </header>
        <div class="hs-modal-body">{props.children}</div>
      </div>
    </div>
  );
}

export interface ConfirmRequest {
  readonly title: string;
  readonly text?: string;
  readonly yes: string;
  readonly danger?: boolean;
  run(): void;
}

/** A confirm dialog ignores its "yes" this long after it opened (Enter-Enter must not reset the night). */
const CONFIRM_GUARD_MS = 700;

export function ConfirmDialog(props: { readonly req: ConfirmRequest; onClose(): void }): JSX.Element {
  const { req } = props;
  const [openedAt] = useState(() => performance.now());
  useLayoutEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === ' ') {
        // Space would "click" whatever button kept the focus: only Enter answers, and only on purpose
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key !== 'Enter' || e.repeat || performance.now() - openedAt < CONFIRM_GUARD_MS) return;
        props.onClose();
        req.run();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [req]);
  return (
    <Modal title={req.title} onClose={props.onClose} testId="confirm">
      {req.text !== undefined ? <p class="hs-confirm-text">{req.text}</p> : null}
      <div class="hs-confirm-row">
        <Btn
          label={req.yes}
          tone={req.danger === true ? 'danger' : 'primary'}
          kbd="Enter"
          testId="confirm-yes"
          onClick={() => {
            props.onClose();
            req.run();
          }}
        />
        <Btn label="ביטול" tone="ghost" kbd="Esc" onClick={props.onClose} />
      </div>
    </Modal>
  );
}

export function Switch(props: { readonly on: boolean; readonly label: string; readonly testId?: string; onChange(on: boolean): void }): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      class={`hs-switch ${props.on ? 'is-on' : ''}`}
      data-testid={props.testId}
      onClick={(e) => {
        e.stopPropagation();
        props.onChange(!props.on);
      }}
    >
      <span class="hs-switch-track">
        <span class="hs-switch-knob" />
      </span>
      <span class="hs-switch-label">{props.label}</span>
      <span class="hs-switch-state">{props.on ? 'פועל' : 'כבוי'}</span>
    </button>
  );
}

/** Shows a message for a few seconds; a new `id` restarts it. */
export function Toast(props: { readonly id: number; readonly text: string; readonly tone: 'info' | 'error' }): JSX.Element | null {
  const [visibleId, setVisibleId] = useState(props.id);
  useEffect(() => {
    setVisibleId(props.id);
    const t = setTimeout(() => setVisibleId(-1), 4_500);
    return () => clearTimeout(t);
  }, [props.id]);
  if (visibleId !== props.id) return null;
  return (
    <div class={`hs-toast hs-toast--${props.tone}`} key={props.id} role="status">
      {props.tone === 'error' ? '⚠️ ' : '✨ '}
      {props.text}
    </div>
  );
}
