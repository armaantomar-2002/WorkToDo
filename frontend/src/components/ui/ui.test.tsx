import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, ConfirmDialog, FormField, Input, ImportanceBadge, Modal, PasswordInput, PasswordStrength, Pagination, StatusBadge } from './index';
import { passwordScore } from './PasswordStrength';

describe('design system', () => {
  it('Button shows a busy state and blocks clicks while loading', async () => {
    const onClick = vi.fn(); render(<Button loading onClick={onClick}>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' }); expect(b).toBeDisabled(); expect(b).toHaveAttribute('aria-busy', 'true'); await userEvent.click(b); expect(onClick).not.toHaveBeenCalled();
  });
  it('FormField links label, input and error message accessibly', () => {
    render(<FormField label="Email" htmlFor="e" error="Required"><Input id="e" invalid /></FormField>);
    const input = screen.getByLabelText('Email'); expect(input).toHaveAttribute('aria-invalid', 'true'); expect(input).toHaveAttribute('aria-describedby', 'e-error'); expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });
  it('PasswordInput toggles visibility', async () => {
    render(<PasswordInput id="p" aria-label="Password" />); const input = screen.getByLabelText('Password'); expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' })); expect(input).toHaveAttribute('type', 'text'); expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument();
  });
  it('PasswordStrength scores', () => {
    expect(passwordScore('abc').score).toBe(0); expect(passwordScore('abcdefg1').score).toBe(2); expect(passwordScore('Abcdefghij1!').score).toBe(4);
    render(<PasswordStrength password="abcdefg1" />); expect(screen.getByText(/Password strength: Fair/)).toBeInTheDocument();
  });
  it('badges map values to text', () => { render(<><ImportanceBadge value="Critical" /><StatusBadge value="In Progress" /></>); expect(screen.getByText('Critical')).toBeInTheDocument(); expect(screen.getByText('In Progress')).toBeInTheDocument(); });
  it('Pagination disables edges and reports pages', async () => {
    const onPage = vi.fn(); render(<Pagination page={1} totalPages={3} total={25} onPage={onPage} noun="tasks" />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled(); await userEvent.click(screen.getByRole('button', { name: 'Next page' })); expect(onPage).toHaveBeenCalledWith(2); expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });
  it('Modal is an accessible dialog: focus moves in, Escape closes, focus returns', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<><button>opener</button><Modal open onClose={onClose} title="Edit"><input aria-label="name" /></Modal></>);
    const dialog = screen.getByRole('dialog', { name: 'Edit' }); expect(dialog).toHaveAttribute('aria-modal', 'true');
    await userEvent.keyboard('{Escape}'); expect(onClose).toHaveBeenCalled();
    rerender(<><button>opener</button><Modal open={false} onClose={onClose} title="Edit"><input aria-label="name" /></Modal></>); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('ConfirmDialog confirms and cancels', async () => {
    const ok = vi.fn(); const no = vi.fn(); render(<ConfirmDialog open title="Delete task?" message="Sure?" onConfirm={ok} onCancel={no} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' })); expect(ok).toHaveBeenCalled(); await userEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(no).toHaveBeenCalled();
  });
});
