import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal } from './Modal';
import { IconInput } from './IconInput';
import { LoadingState } from './StateViews';

describe('Modal', () => {
  const original = HTMLElement.prototype.getClientRects;
  beforeEach(() => {
    // jsdom has no layout; report every element as rendered so the trap's visibility filter works.
    HTMLElement.prototype.getClientRects = () => [{}] as unknown as DOMRectList;
  });
  afterEach(() => { HTMLElement.prototype.getClientRects = original; });

  it('returns focus to the opener even when a child autoFocuses', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <Modal onClose={() => {}} ariaLabel="AF" showClose={false}>
        <IconInput placeholder="Email" autoFocus />
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Email'));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('exposes a labelled aria-modal dialog and moves focus inside', () => {
    render(
      <Modal onClose={() => {}} labelledBy="t">
        <h2 id="t">Title</h2>
        <button>First</button>
        <button>Last</button>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Title' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape and on backdrop click, not on panel click', () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} ariaLabel="Demo" showClose={false}>
        <button>Inside</button>
      </Modal>,
    );
    fireEvent.click(screen.getByText('Inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('traps Tab inside the dialog and returns focus on unmount', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(
      <Modal onClose={() => {}} ariaLabel="Trap" showClose={false}>
        <button>A</button>
        <button>B</button>
      </Modal>,
    );
    const b = screen.getByText('B');
    b.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('A'));
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});

describe('IconInput a11y', () => {
  it('derives an aria-label from the placeholder and a stable id', () => {
    render(<IconInput placeholder="Your email" required />);
    const input = screen.getByLabelText('Your email');
    expect(input.id).toBeTruthy();
  });

  it('respects an explicit aria-label', () => {
    render(<IconInput placeholder="x" aria-label="Custom" />);
    expect(screen.getByLabelText('Custom')).toBeTruthy();
  });
});

describe('LoadingState', () => {
  it('is a busy status region', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });
});
