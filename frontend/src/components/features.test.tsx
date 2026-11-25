import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../test/utils';
import { FeedbackBar } from './recommendations/FeedbackBar';
import { DependencyManager } from './tasks/DependencyManager';
import { FocusTimerPanel } from './timer/FocusTimerPanel';
import type { FocusTimer, Task } from '../lib/types';

const h = vi.hoisted(() => ({
  save: vi.fn(), clear: vi.fn(), add: vi.fn(), remove: vi.fn(), start: vi.fn(), act: vi.fn(),
  dependencies: { current: null as unknown }, active: { current: null as unknown }, tasks: { current: null as unknown },
}));
const mutation = (fn: ReturnType<typeof vi.fn>) => ({ mutate: (v: unknown, o?: { onSuccess?: (r: unknown) => void }) => fn(v, o), isPending: false, variables: undefined });
vi.mock('../api/hooks', () => ({
  useSaveFeedback: () => mutation(h.save), useClearFeedback: () => mutation(h.clear),
  useDependencies: () => h.dependencies.current, useAddDependency: () => mutation(h.add), useRemoveDependency: () => mutation(h.remove),
  useTasks: () => h.tasks.current, useActiveTimer: () => h.active.current, useStartTimer: () => mutation(h.start), useTimerAction: () => mutation(h.act),
}));

const fb = (feedbackType: string, comment: string | null = null) => ({ feedbackType, comment, createdAt: '', updatedAt: '' });
const TASK = { id: 't1', taskName: 'Main', status: 'Pending', dependencyStatus: 'Blocked' } as Task;
const task = (id: string, name: string, status = 'Pending', est = 45) => ({ id, taskName: name, status, estimatedDurationMinutes: est, dependencyStatus: 'No dependency' });
const timer = (extra: Partial<FocusTimer> = {}): FocusTimer => ({ id: 'tm1', status: 'running', taskId: 't1', taskName: 'Main', focusSessionId: null, plannedDurationMinutes: 25, plannedSeconds: 1500, startedAt: '2026-11-24T10:00:00.000Z', endedAt: null, elapsedSeconds: 300, pausedSeconds: 0, remainingSeconds: 1200, overtimeSeconds: 0, isOvertime: false, pauses: [], serverNow: '2026-11-24T10:05:00.000Z', ...extra });

beforeEach(() => { Object.values(h).forEach((v) => { if (typeof v === 'function') (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.tasks.current = { isPending: false, data: { items: [task('t1', 'Main'), task('t2', 'Other'), task('t3', 'Third')] } }; });

describe('FeedbackBar', () => {
  it('saves the chosen option to the API and marks it pressed', async () => {
    h.save.mockImplementation((_v, o) => o?.onSuccess?.(fb('helpful')));
    renderWithProviders(<FeedbackBar runId="r1" itemId="i1" taskName="Main" initial={null} />);
    await userEvent.click(screen.getByRole('button', { name: /^Helpful/ }));
    expect(h.save).toHaveBeenCalledWith({ runId: 'r1', itemId: 'i1', feedbackType: 'helpful', comment: null }, expect.anything());
    expect(screen.getByRole('button', { name: /^Helpful/ })).toHaveAttribute('aria-pressed', 'true'); expect(screen.getByText('Saved')).toBeInTheDocument();
  });
  it('shows previously saved feedback (history) and can replace, annotate and clear it', async () => {
    h.save.mockImplementation((v, o) => o?.onSuccess?.(fb(v.feedbackType, v.comment))); h.clear.mockImplementation((_v, o) => o?.onSuccess?.(undefined));
    renderWithProviders(<FeedbackBar runId="r1" itemId="i1" taskName="Main" initial={fb('not_helpful') as never} />);
    expect(screen.getByRole('button', { name: /^Not helpful/ })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: /^Already done/ })); expect(h.save).toHaveBeenLastCalledWith(expect.objectContaining({ feedbackType: 'already_done' }), expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Add note' })); await userEvent.type(screen.getByLabelText('Feedback note'), 'finished yesterday'); await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(h.save).toHaveBeenLastCalledWith({ runId: 'r1', itemId: 'i1', feedbackType: 'already_done', comment: 'finished yesterday' }, expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Clear' })); expect(h.clear).toHaveBeenCalledWith({ runId: 'r1', itemId: 'i1' }, expect.anything());
    expect(screen.getByRole('button', { name: /^Already done/ })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('DependencyManager', () => {
  beforeEach(() => { h.dependencies.current = { isPending: false, isError: false, data: { taskId: 't1', dependencyStatus: 'Blocked', prerequisites: [{ id: 't2', taskName: 'Other', status: 'Pending', dueDate: null, isBlocking: true }], dependents: [{ id: 't9', taskName: 'Later', status: 'Pending' }] } }; });
  it('lists prerequisites with the blocking state and what this task blocks', () => {
    renderWithProviders(<DependencyManager task={TASK} />);
    expect(screen.getByText('Blocked')).toBeInTheDocument(); expect(screen.getByText('Other')).toBeInTheDocument(); expect(screen.getByText(/Blocks: Later/)).toBeInTheDocument();
  });
  it('offers only valid candidates (not itself, not existing prerequisites) and adds the chosen one', async () => {
    renderWithProviders(<DependencyManager task={TASK} />);
    const select = screen.getByLabelText('Add a prerequisite'); const names = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(names).toEqual(['Choose a task…', 'Third (Pending)']);
    expect(screen.getByRole('button', { name: 'Add dependency' })).toBeDisabled();
    await userEvent.selectOptions(select, 't3'); await userEvent.click(screen.getByRole('button', { name: 'Add dependency' }));
    expect(h.add).toHaveBeenCalledWith({ taskId: 't1', dependsOnTaskId: 't3' }, expect.anything());
  });
  it('removes a prerequisite', async () => {
    renderWithProviders(<DependencyManager task={TASK} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove prerequisite Other' })); expect(h.remove).toHaveBeenCalledWith({ taskId: 't1', prerequisiteId: 't2' }, expect.anything());
  });
});

describe('FocusTimerPanel', () => {
  it('idle: starts a timer for the chosen task, defaulting the planned minutes to the task estimate', async () => {
    h.active.current = { isPending: false, isError: false, data: null, dataUpdatedAt: Date.now(), isFetching: false };
    renderWithProviders(<FocusTimerPanel />);
    await userEvent.selectOptions(screen.getByLabelText('Task (optional)'), 't2'); expect(screen.getByLabelText('Planned (minutes)')).toHaveValue(45);
    await userEvent.click(screen.getByRole('button', { name: /Start Focus/ })); expect(h.start).toHaveBeenCalledWith({ taskId: 't2', plannedDurationMinutes: 45 }, expect.anything());
  });
  it('idle: rejects an invalid planned duration locally', async () => {
    h.active.current = { isPending: false, isError: false, data: null, dataUpdatedAt: Date.now(), isFetching: false };
    renderWithProviders(<FocusTimerPanel />);
    const m = screen.getByLabelText('Planned (minutes)'); await userEvent.clear(m); await userEvent.type(m, '0'); await userEvent.click(screen.getByRole('button', { name: /Start Focus/ }));
    expect(screen.getByText('Enter 1–720 minutes')).toBeInTheDocument(); expect(h.start).not.toHaveBeenCalled();
  });
  it('running: shows server-derived remaining/elapsed from a persisted timer (as after a page refresh) and offers pause/finish/cancel', async () => {
    h.active.current = { isPending: false, isError: false, data: timer(), dataUpdatedAt: Date.now(), isFetching: false };
    renderWithProviders(<FocusTimerPanel />);
    // Server snapshot: 300 s elapsed of 1500 s planned. The display may be 0-4 s ahead of the snapshot (wall-clock delta since fetch),
    // so assert the invariant elapsed + remaining === planned instead of a value that only holds after a tick.
    const secs = (id: string) => { const [m, sec] = screen.getByTestId(id).textContent!.split(':').map(Number); return m * 60 + sec; };
    expect(secs('timer-elapsed')).toBeGreaterThanOrEqual(300); expect(secs('timer-elapsed')).toBeLessThan(305);
    expect(secs('timer-elapsed') + secs('timer-main')).toBe(1500); expect(screen.getByText('Running')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Pause/ })); expect(h.act).toHaveBeenCalledWith({ id: 'tm1', action: 'pause' }, expect.anything());
  });
  it('paused: does not advance and offers Resume', () => {
    h.active.current = { isPending: false, isError: false, data: timer({ status: 'paused', pauses: [{ pausedAt: '2026-11-24T10:05:00.000Z', resumedAt: null }] }), dataUpdatedAt: Date.now() - 3_600_000, isFetching: false };
    renderWithProviders(<FocusTimerPanel />);
    expect(screen.getByTestId('timer-elapsed')).toHaveTextContent('5:00'); expect(screen.getByRole('button', { name: /Resume/ })).toBeInTheDocument(); expect(screen.getByText('Paused')).toBeInTheDocument();
  });
  it('overtime is shown separately; finishing can also complete the task', async () => {
    h.active.current = { isPending: false, isError: false, data: timer({ elapsedSeconds: 1620, isOvertime: true, overtimeSeconds: 120, remainingSeconds: 0 }), dataUpdatedAt: Date.now(), isFetching: false };
    renderWithProviders(<FocusTimerPanel />);
    expect(screen.getByTestId('timer-main')).toHaveTextContent(/^\+2:0\d$/); expect(screen.getByText('overtime')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Finish/ })); await userEvent.click(screen.getByLabelText(/Also mark/)); await userEvent.click(screen.getAllByRole('button', { name: 'Finish' }).at(-1)!);
    await waitFor(() => expect(h.act).toHaveBeenCalledWith({ id: 'tm1', action: 'finish', completeTask: true }, expect.anything()));
  });
});
