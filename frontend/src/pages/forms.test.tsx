import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import { registerSchema } from './RegisterPage';
import { sessionSchema } from './SessionsPage';
import { TaskFormModal, taskFormSchema, toTaskInput } from './TaskFormModal';

const BASE = { taskName: 'Write report', description: '', startDate: '', dueDate: '', importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Major', estimatedDurationMinutes: 60, isSplittable: false, minimumSessionMinutes: null, preferredTime: 'Anytime', status: 'Pending' } as const;
const messages = (r: { success: boolean; error?: { issues: { path: (string | number)[]; message: string }[] } }) => (r.success ? [] : r.error!.issues.map((i) => `${i.path.join('.')}: ${i.message}`));

describe('form schemas mirror the backend rules', () => {
  it('task schema: required name, duration bounds, due >= start, splittable minimum session', () => {
    expect(taskFormSchema.safeParse(BASE).success).toBe(true);
    expect(messages(taskFormSchema.safeParse({ ...BASE, taskName: '  ' }))).toContain('taskName: Task name is required');
    expect(messages(taskFormSchema.safeParse({ ...BASE, estimatedDurationMinutes: 0 }))[0]).toMatch(/estimatedDurationMinutes/);
    expect(messages(taskFormSchema.safeParse({ ...BASE, estimatedDurationMinutes: Number.NaN }))[0]).toMatch(/Enter the estimated minutes/);
    expect(messages(taskFormSchema.safeParse({ ...BASE, startDate: '2026-12-05', dueDate: '2026-12-01' }))).toContain('dueDate: Due date cannot be before the start date');
    expect(messages(taskFormSchema.safeParse({ ...BASE, isSplittable: true }))).toContain('minimumSessionMinutes: Required for splittable tasks');
    expect(messages(taskFormSchema.safeParse({ ...BASE, isSplittable: true, minimumSessionMinutes: 90 }))).toContain('minimumSessionMinutes: Cannot exceed the estimated duration');
    expect(taskFormSchema.safeParse({ ...BASE, isSplittable: true, minimumSessionMinutes: 30 }).success).toBe(true);
  });
  it('toTaskInput normalises blanks to null and drops minimum session for non-splittable tasks', () => {
    expect(toTaskInput({ ...BASE, description: '  ', minimumSessionMinutes: 20 })).toMatchObject({ description: null, startDate: null, dueDate: null, minimumSessionMinutes: null });
    expect(toTaskInput({ ...BASE, isSplittable: true, minimumSessionMinutes: 20, dueDate: '2026-12-01' })).toMatchObject({ minimumSessionMinutes: 20, dueDate: '2026-12-01' });
  });
  it('session schema: longest slot cannot exceed available time', () => {
    const ok = { sessionDateTime: '2026-11-16T10:00', availableTimeMinutes: 120, longestFreeSlotMinutes: 90, energyLevel: 'High', focusLevel: 'Medium', currentTimePeriod: 'Morning' };
    expect(sessionSchema.safeParse(ok).success).toBe(true);
    expect(messages(sessionSchema.safeParse({ ...ok, longestFreeSlotMinutes: 121 }))).toContain('longestFreeSlotMinutes: Cannot exceed the available time');
    expect(sessionSchema.safeParse({ ...ok, availableTimeMinutes: 0 }).success).toBe(false);
  });
  it('register schema: policy and matching passwords', () => {
    const ok = { fullName: 'A B', email: 'a@b.co', password: 'Password123', confirmPassword: 'Password123' };
    expect(registerSchema.safeParse(ok).success).toBe(true);
    expect(messages(registerSchema.safeParse({ ...ok, confirmPassword: 'x' }))).toContain('confirmPassword: Passwords do not match');
    expect(registerSchema.safeParse({ ...ok, password: 'allletters', confirmPassword: 'allletters' }).success).toBe(false);
    expect(registerSchema.safeParse({ ...ok, email: 'nope' }).success).toBe(false);
  });
});

const create = vi.fn(); const update = vi.fn();
vi.mock('../api/hooks', () => ({ useCreateTask: () => ({ mutateAsync: create }), useUpdateTask: () => ({ mutateAsync: update }) }));

describe('TaskFormModal', () => {
  beforeEach(() => { create.mockReset(); update.mockReset(); });
  it('shows validation errors and does not submit an empty form', async () => {
    renderWithProviders(<TaskFormModal open task={null} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(await screen.findByText('Task name is required')).toBeInTheDocument(); expect(create).not.toHaveBeenCalled();
  });
  it('reveals "Minimum Session" only for splittable tasks and enforces it', async () => {
    renderWithProviders(<TaskFormModal open task={null} onClose={() => {}} />);
    expect(screen.queryByLabelText('Minimum Session')).toBeNull();
    await userEvent.click(screen.getByLabelText('This task can be split into several sessions'));
    expect(screen.getByLabelText('Minimum Session')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Task Name'), 'Plan'); await userEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(await screen.findByText('Required for splittable tasks')).toBeInTheDocument(); expect(create).not.toHaveBeenCalled();
  });
  it('submits the exact API payload for a valid task', async () => {
    create.mockResolvedValue({}); const onClose = vi.fn();
    renderWithProviders(<TaskFormModal open task={null} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Task Name'), '  Write report  '); await userEvent.selectOptions(screen.getByLabelText('Importance'), 'Critical'); await userEvent.type(screen.getByLabelText('Due Date'), '2026-12-01');
    await userEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).toEqual({ taskName: 'Write report', description: null, startDate: null, dueDate: '2026-12-01', importance: 'Critical', goalContribution: 'Medium', consequenceOfDelay: 'Moderate', estimatedDurationMinutes: 30, isSplittable: false, minimumSessionMinutes: null, preferredTime: 'Anytime', status: 'Pending' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('task form: no Complexity, hours + minutes duration', () => {
  it('does not offer Complexity and sends no complexity field (the API keeps / defaults it)', async () => {
    create.mockResolvedValue({});
    renderWithProviders(<TaskFormModal open task={null} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Complexity')).toBeNull();
    await userEvent.type(screen.getByLabelText('Task Name'), 'Read'); await userEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0]).not.toHaveProperty('complexity');
  });
  it('converts hours and minutes to total minutes and validates', async () => {
    create.mockResolvedValue({});
    renderWithProviders(<TaskFormModal open task={null} onClose={vi.fn()} />);
    const h = screen.getAllByLabelText('Hours')[0]; const m = screen.getAllByLabelText('Minutes')[0];
    await userEvent.clear(h); await userEvent.type(h, '1'); await userEvent.clear(m); await userEvent.type(m, '30');
    expect(screen.getByTestId('estimatedDurationMinutes-total')).toHaveTextContent('1 hour 30 minutes');
    await userEvent.clear(m); await userEvent.type(m, '75');
    expect(screen.getByText('Minutes must be between 0 and 59')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Task Name'), 'Plan'); await userEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    expect(await screen.findByText('Enter the estimated duration')).toBeInTheDocument(); expect(create).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '2 hours' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create Task' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0][0].estimatedDurationMinutes).toBe(120);
  });
});
