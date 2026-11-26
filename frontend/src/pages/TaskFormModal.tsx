import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Checkbox, DurationInput, FormField, Input, Modal, Select, Textarea, useToast } from '../components/ui';
import { useAddDependency, useCreateTask, useTasks, useUpdateTask } from '../api/hooks';
import { formatDate, formatTime } from '../lib/format';
import { fieldErrorsOf, messageOf } from '../lib/api';
import { CONSEQUENCE, GOAL_CONTRIBUTION, IMPORTANCE, PREFERRED_TIME, TASK_STATUS, type Task, type TaskInput } from '../lib/types';


export const taskFormSchema = z.object({
  taskName: z.string().trim().min(1, 'Task name is required').max(200, 'Task name must be at most 200 characters'),
  description: z.string().max(2000, 'Description must be at most 2000 characters'),
  startDate: z.string(), dueDate: z.string(),
  importance: z.enum(['Critical', 'High', 'Medium', 'Low']),
  goalContribution: z.enum(['Essential', 'High', 'Medium', 'Low', 'No linked goal']),
  consequenceOfDelay: z.enum(['Major', 'Significant', 'Moderate', 'Minor', 'None']),
  estimatedDurationMinutes: z.number({ invalid_type_error: 'Enter the estimated duration', required_error: 'Enter the estimated duration' }).int('Use whole minutes').min(1, 'Duration must be greater than zero').max(10080, 'Must be at most 7 days'),
  isSplittable: z.boolean(),
  minimumSessionMinutes: z.number().int('Use whole minutes').min(1, 'Must be greater than zero').nullable(),
  preferredTime: z.enum(['Morning', 'Afternoon', 'Evening', 'Night', 'Anytime']),
  status: z.enum(['Pending', 'In Progress', 'Completed', 'Cancelled']),
  // Optional so existing callers/tests that do not know about them still validate. isFixedTime=true => an exact-time appointment.
  isFixedTime: z.boolean().optional(), fixedDate: z.string().optional(), fixedStart: z.string().optional(),
  prerequisiteIds: z.array(z.string()).optional(),
}).superRefine((v, ctx) => {
  if (v.isFixedTime) {
    if (!v.fixedDate) ctx.addIssue({ code: 'custom', path: ['fixedDate'], message: 'Choose the appointment date' });
    if (!v.fixedStart) ctx.addIssue({ code: 'custom', path: ['fixedStart'], message: 'Choose the exact start time' });
    if (v.estimatedDurationMinutes > 1440) ctx.addIssue({ code: 'custom', path: ['estimatedDurationMinutes'], message: 'A fixed appointment cannot be longer than 24 hours' });
    return;
  }
  if (v.startDate && v.dueDate && v.dueDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Due date cannot be before the start date' });
  if (v.isSplittable) {
    if (v.minimumSessionMinutes === null) ctx.addIssue({ code: 'custom', path: ['minimumSessionMinutes'], message: 'Required for splittable tasks' });
    else if (v.minimumSessionMinutes > v.estimatedDurationMinutes) ctx.addIssue({ code: 'custom', path: ['minimumSessionMinutes'], message: 'Cannot exceed the estimated duration' });
  }
});
export type TaskFormValues = z.infer<typeof taskFormSchema>;

const DEFAULTS: TaskFormValues = { taskName: '', description: '', startDate: '', dueDate: '', importance: 'Medium', goalContribution: 'Medium', consequenceOfDelay: 'Moderate', isFixedTime: false, fixedDate: '', fixedStart: '', prerequisiteIds: [], estimatedDurationMinutes: 30, isSplittable: false, minimumSessionMinutes: null, preferredTime: 'Anytime', status: 'Pending' };
const fromTask = (t: Task): TaskFormValues => ({ taskName: t.taskName, description: t.description ?? '', startDate: t.startDate ?? '', dueDate: t.dueDate ?? '', importance: t.importance, goalContribution: t.goalContribution, consequenceOfDelay: t.consequenceOfDelay, estimatedDurationMinutes: t.estimatedDurationMinutes, isSplittable: t.isSplittable, minimumSessionMinutes: t.minimumSessionMinutes, preferredTime: t.preferredTime, status: t.status,
  isFixedTime: !!t.isFixedTime, fixedDate: t.fixedTime?.startAt.slice(0, 10) ?? '', fixedStart: t.fixedTime?.startAt.slice(11, 16) ?? '', prerequisiteIds: [] });
/** Wall-clock end of a fixed appointment (pure string/number arithmetic, no Date objects, so no timezone can move it). */
export function fixedEnd(date: string, start: string, minutes: number): { date: string; time: string } | null {
  if (!date || !start || !Number.isFinite(minutes)) return null;
  const [y, m, d] = date.split('-').map(Number); const [h, mi] = start.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h, mi + minutes)); const p2 = (n: number) => String(n).padStart(2, '0');
  return { date: `${t.getUTCFullYear()}-${p2(t.getUTCMonth() + 1)}-${p2(t.getUTCDate())}`, time: `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}` };
}
/** `wasFixed`: editing a fixed task and switching it to flexible sends fixedTime:null so the server releases the appointment. */
export const toTaskInput = (v: TaskFormValues, wasFixed = false): TaskInput => {
  const { isFixedTime, fixedDate, fixedStart, prerequisiteIds: _ids, ...rest } = v; // form-only fields are never sent (the API whitelists its fields)
  const base = { ...rest, description: v.description.trim() || null, startDate: v.startDate || null, dueDate: v.dueDate || null, minimumSessionMinutes: v.isSplittable ? v.minimumSessionMinutes : null };
  if (isFixedTime) return { ...base, startDate: null, dueDate: null, isSplittable: false, minimumSessionMinutes: null, preferredTime: 'Anytime', fixedTime: { startAt: `${fixedDate}T${fixedStart}`, durationMinutes: v.estimatedDurationMinutes } };
  return wasFixed ? { ...base, fixedTime: null } : base;
};

const Options = ({ values }: { values: readonly string[] }) => <>{values.map((o) => <option key={o} value={o}>{o}</option>)}</>;

export function TaskFormModal({ open, task, onClose }: { open: boolean; task: Task | null; onClose: () => void }) {
  const create = useCreateTask(); const update = useUpdateTask(); const addDep = useAddDependency(); const toast = useToast();
  const openTasks = useTasks({ status: ['Pending', 'In Progress'], sortBy: 'taskName', sortOrder: 'asc', page: 1, pageSize: 100 });
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, watch, reset, setError, setValue, formState: { errors, isSubmitting } } = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema), defaultValues: DEFAULTS });
  const splittable = watch('isSplittable'); const fixed = !!watch('isFixedTime'); const [fixedDate, fixedStart, duration] = watch(['fixedDate', 'fixedStart', 'estimatedDurationMinutes']);
  const picked = watch('prerequisiteIds') ?? []; const [wantsPrereqs, setWantsPrereqs] = useState(false);
  const end = fixed ? fixedEnd(fixedDate ?? '', fixedStart ?? '', duration) : null;
  useEffect(() => { if (open) { reset(task ? fromTask(task) : DEFAULTS); setFormError(null); setWantsPrereqs(false); } }, [open, task, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input = toTaskInput(values, !!task?.isFixedTime);
    try {
      if (task) await update.mutateAsync({ id: task.id, patch: input });
      else {
        const created = await create.mutateAsync(input);
        // prerequisites use the existing dependency API (ownership, cycle and duplicate checks stay on the server)
        const failed: string[] = [];
        if (wantsPrereqs) for (const pid of values.prerequisiteIds ?? []) { try { await addDep.mutateAsync({ taskId: created.id, dependsOnTaskId: pid }); } catch (e) { failed.push(messageOf(e)); } }
        if (failed.length) toast.error(`Task created, but a prerequisite could not be added: ${failed[0]}`);
      }
      toast.success(task ? 'Task updated' : 'Task created');
      onClose();
    } catch (e) {
      const fields = fieldErrorsOf(e); let handled = false;
      for (const [f, message] of Object.entries(fields)) if (f in DEFAULTS || f.startsWith('fixedTime')) { setError((f.startsWith('fixedTime') ? 'fixedStart' : f) as keyof TaskFormValues, { message }); handled = true; }
      if (!handled) setFormError(messageOf(e));
    }
  });

  return (
    <Modal open={open} onClose={onClose} title={task ? 'Edit Task' : 'Add Task'} wide
      footer={<><Button variant="secondary" onClick={onClose} disabled={isSubmitting}>Cancel</Button><Button type="submit" form="task-form" loading={isSubmitting}>{task ? 'Save Changes' : 'Create Task'}</Button></>}>
      <form id="task-form" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2" aria-label={task ? 'Edit task' : 'Add task'}>
        {formError && <div className="sm:col-span-2"><Alert tone="error">{formError}</Alert></div>}
        <FormField className="sm:col-span-2" label="Task Name" htmlFor="taskName" error={errors.taskName?.message}><Input id="taskName" invalid={!!errors.taskName} maxLength={200} {...register('taskName')} /></FormField>
        <FormField className="sm:col-span-2" label="Description (optional)" htmlFor="description" error={errors.description?.message}><Textarea id="description" invalid={!!errors.description} {...register('description')} /></FormField>
        <fieldset className="sm:col-span-2 space-y-2 rounded-lg bg-surface-2 p-3">
          <legend className="px-1 text-sm font-semibold">Does this task need to happen at a specific time?</legend>
          <Controller control={control} name="isFixedTime" render={({ field }) => (
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Task timing">
              <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm ${!field.value ? 'border-olive bg-surface' : 'border-line'}`}><input type="radio" name="timing" checked={!field.value} onChange={() => field.onChange(false)} className="mt-1" /><span><b>Flexible task</b><br /><span className="text-xs text-muted">Can be completed at any suitable time.</span></span></label>
              <label className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm ${field.value ? 'border-terracotta bg-surface' : 'border-line'}`}><input type="radio" name="timing" checked={!!field.value} onChange={() => field.onChange(true)} className="mt-1" /><span><b>Fixed-time task</b><br /><span className="text-xs text-muted">Must happen at a specific date and time. It is never moved automatically.</span></span></label>
            </div>)} />
        </fieldset>
        {fixed ? (<>
          <FormField label="Appointment Date" htmlFor="fixedDate" error={errors.fixedDate?.message}><Input id="fixedDate" type="date" invalid={!!errors.fixedDate} {...register('fixedDate')} /></FormField>
          <FormField label="Exact Start Time" htmlFor="fixedStart" error={errors.fixedStart?.message}><Input id="fixedStart" type="time" invalid={!!errors.fixedStart} {...register('fixedStart')} /></FormField>
          {end && <p className="sm:col-span-2 rounded-lg bg-olive-soft px-3 py-2 text-sm font-semibold text-olive-ink" data-testid="fixed-summary">{formatDate(fixedDate)} | {formatTime(`${fixedDate}T${fixedStart}`)} – {formatTime(`${end.date}T${end.time}`)}{end.date !== fixedDate ? ` (${formatDate(end.date)})` : ''}</p>}
        </>) : (<>
          <FormField label="Start Date" htmlFor="startDate" error={errors.startDate?.message} hint="Task is not eligible before this date."><Input id="startDate" type="date" hasHint {...register('startDate')} /></FormField>
          <FormField label="Due Date" htmlFor="dueDate" error={errors.dueDate?.message}><Input id="dueDate" type="date" invalid={!!errors.dueDate} {...register('dueDate')} /></FormField>
        </>)}
        <FormField label="Importance" htmlFor="importance" error={errors.importance?.message}><Select id="importance" {...register('importance')}><Options values={IMPORTANCE} /></Select></FormField>
        <FormField label="Goal Contribution" htmlFor="goalContribution" error={errors.goalContribution?.message}><Select id="goalContribution" {...register('goalContribution')}><Options values={GOAL_CONTRIBUTION} /></Select></FormField>
        <FormField label="Consequence of Delay" htmlFor="consequenceOfDelay" error={errors.consequenceOfDelay?.message}><Select id="consequenceOfDelay" {...register('consequenceOfDelay')}><Options values={CONSEQUENCE} /></Select></FormField>
        <FormField className="sm:col-span-2" label={fixed ? 'Duration' : 'Estimated Duration'} htmlFor="estimatedDurationMinutes" error={errors.estimatedDurationMinutes?.message}>
          <Controller control={control} name="estimatedDurationMinutes" render={({ field }) => <DurationInput id="estimatedDurationMinutes" value={Number.isFinite(field.value) ? field.value : null} onChange={(v) => field.onChange(v ?? Number.NaN)} invalid={!!errors.estimatedDurationMinutes} />} />
        </FormField>
        {!fixed && <FormField label="Preferred Time" htmlFor="preferredTime" error={errors.preferredTime?.message}><Select id="preferredTime" {...register('preferredTime')}><Options values={PREFERRED_TIME} /></Select></FormField>}
        {!fixed && <div className="sm:col-span-2 space-y-3 rounded-lg bg-surface-2 p-3">
          <Checkbox id="isSplittable" label="This task can be split into several sessions" {...register('isSplittable')} />
          {splittable && <FormField label="Minimum Session" htmlFor="minimumSessionMinutes" error={errors.minimumSessionMinutes?.message} hint="The shortest useful session. Must not exceed the estimated duration.">
            <Controller control={control} name="minimumSessionMinutes" render={({ field }) => <DurationInput id="minimumSessionMinutes" value={field.value} onChange={field.onChange} invalid={!!errors.minimumSessionMinutes} presets={false} />} />
          </FormField>}
        </div>}
        {!task && <fieldset className="sm:col-span-2 space-y-2 rounded-lg bg-surface-2 p-3">
          <legend className="px-1 text-sm font-semibold">Does this task depend on another task being completed first?</legend>
          <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Dependency">
            <label className="flex items-center gap-2"><input type="radio" name="hasPrereqs" checked={!wantsPrereqs} onChange={() => { setWantsPrereqs(false); setValue('prerequisiteIds', []); }} />No dependency</label>
            <label className="flex items-center gap-2"><input type="radio" name="hasPrereqs" checked={wantsPrereqs} onChange={() => setWantsPrereqs(true)} />Yes, this task has prerequisites</label>
          </div>
          {wantsPrereqs && (openTasks.data?.items.length ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-sm" aria-label="Choose prerequisites">{openTasks.data.items.map((t) => (
              <li key={t.id}><label className="flex items-center gap-2"><input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setValue('prerequisiteIds', e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} />{t.taskName}<span className="text-xs text-muted">{t.fixedTime ? `${formatDate(t.fixedTime.startAt.slice(0, 10))} ${formatTime(t.fixedTime.startAt)}` : t.dueDate ? `due ${formatDate(t.dueDate)}` : ''}</span></label></li>))}</ul>
          ) : <p className="text-xs text-muted">{openTasks.isPending ? 'Loading your tasks…' : 'You have no open tasks to depend on yet.'}</p>)}
        </fieldset>}
        <FormField label="Status" htmlFor="status" error={errors.status?.message}><Select id="status" {...register('status')}><Options values={TASK_STATUS} /></Select></FormField>
      </form>
    </Modal>
  );
}
