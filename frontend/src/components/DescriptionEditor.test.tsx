import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DescriptionEditor } from './DescriptionEditor';

vi.mock('../lib/supabase', () => ({ uploadDescriptionImage: vi.fn() }));

const setup = (value = '') => {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <DescriptionEditor value={value} onChange={onChange} onSave={onSave} onClose={onClose} saving={false} partyId="p1" />,
  );
  return { onChange, onSave, onClose, ...utils };
};

describe('DescriptionEditor', () => {
  it('does not propagate to the parent on every keystroke', async () => {
    const { onChange } = setup();
    await userEvent.type(screen.getByPlaceholderText('Describe your event...'), 'hello');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('flushes on blur', async () => {
    const { onChange } = setup();
    await userEvent.type(screen.getByPlaceholderText('Describe your event...'), 'hi');
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('hi');
  });

  it('passes the final value to onSave', async () => {
    const { onSave, onChange } = setup('a');
    await userEvent.type(screen.getByPlaceholderText('Describe your event...'), 'bc');
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSave).toHaveBeenCalledWith('abc');
    expect(onChange).toHaveBeenLastCalledWith('abc');
  });

  it('flushes on unmount', async () => {
    const { onChange, unmount } = setup();
    await userEvent.type(screen.getByPlaceholderText('Describe your event...'), 'xyz');
    unmount();
    expect(onChange).toHaveBeenCalledWith('xyz');
  });
});
