import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Alert, Button, Checkbox, DurationInput, FormField, Input, Modal, Select, Textarea, useToast } from '../components/ui';
import { useCreateTask, useUpdateTask } from '../api/hooks';
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
}).superRefine((v, ctx) => {
  if (v.startDate && v.dueDate && v.dueDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Due date cannot be before the start date' });
  if (v.isSplittable) {
    if (v.minimumSessionMinutes === null) ctx.addIssue({ code: 'custom', path: ['minimumSessionMinutes'], message: 'Required for splittable tasks' });
    else if (v.minimumSessionMinutes > v.estimatedDurationMinutes) ctx.addIssue({ code: 'custom', path: ['minimumSessionMinutes'], message: 'Cannot exceed the estimated duration' });
  }
});
export type TaskFormValues = z.infer<typeof taskFormSchema>;

const DEFAULTS: TaskFormValues = { taskName: '', description: '', startDate: '', dueDate: '', importance: 'Medium', goalContribution: 'Medium', consequenceOfDelay: 'Moderate', estimatedDurationMinutes: 30, isSplittable: false, minimumSessionMinutes: null, preferredTime: 'Anytime', status: 'Pending' };
const fromTask = (t: Task): TaskFormValues => ({ taskName: t.taskName, description: t.description ?? '', startDate: t.startDate ?? '', dueDate: t.dueDate ?? '', importance: t.importance, goalContribution: t.goalContribution, consequenceOfDelay: t.consequenceOfDelay, estimatedDurationMinutes: t.estimatedDurationMinutes, isSplittable: t.isSplittable, minimumSessionMinutes: t.minimumSessionMinutes, preferredTime: t.preferredTime, status: t.status });
export const toTaskInput = (v: TaskFormValues): TaskInput => ({ ...v, description: v.description.trim() || null, startDate: v.startDate || null, dueDate: v.dueDate || null, minimumSessionMinutes: v.isSplittable ? v.minimumSessionMinutes : null });

const Options = ({ values }: { values: readonly string[] }) => <>{values.map((o) => <option key={o} value={o}>{o}</option>)}</>;

export function TaskFormModal({ open, task, onClose }: { open: boolean; task: Task | null; onClose: () => void }) {
  const create = useCreateTask(); const update = useUpdateTask(); const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, control, handleSubmit, watch, reset, setError, formState: { errors, isSubmitting } } = useForm<TaskFormValues>({ resolver: zodResolver(taskFormSchema), defaultValues: DEFAULTS });
  const splittable = watch('isSplittable');
  useEffect(() => { if (open) { reset(task ? fromTask(task) : DEFAULTS); setFormError(null); } }, [open, task, reset]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    const input = toTaskInput(values);
    try {
      if (task) await update.mutateAsync({ id: task.id, patch: input }); else await create.mutateAsync(input);
      toast.success(task ? 'Task updated' : 'Task created');
      onClose();
    } catch (e) {
      const fields = fieldErrorsOf(e); let handled = false;
      for (const [f, message] of Object.entries(fields)) if (f in DEFAULTS) { setError(f as keyof TaskFormValues, { message }); handled = true; }
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
        <FormField label="Start Date" htmlFor="startDate" error={errors.startDate?.message} hint="Task is not eligible before this date."><Input id="startDate" type="date" hasHint {...register('startDate')} /></FormField>
        <FormField label="Due Date" htmlFor="dueDate" error={errors.dueDate?.message}><Input id="dueDate" type="date" invalid={!!errors.dueDate} {...register('dueDate')} /></FormField>
        <FormField label="Importance" htmlFor="importance" error={errors.importance?.message}><Select id="importance" {...register('importance')}><Options values={IMPORTANCE} /></Select></FormField>
        <FormField label="Goal Contribution" htmlFor="goalContribution" error={errors.goalContribution?.message}><Select id="goalContribution" {...register('goalContribution')}><Options values={GOAL_CONTRIBUTION} /></Select></FormField>
        <FormField label="Consequence of Delay" htmlFor="consequenceOfDelay" error={errors.consequenceOfDelay?.message}><Select id="consequenceOfDelay" {...register('consequenceOfDelay')}><Options values={CONSEQUENCE} /></Select></FormField>
        <FormField className="sm:col-span-2" label="Estimated Duration" htmlFor="estimatedDurationMinutes" error={errors.estimatedDurationMinutes?.message}>
          <Controller control={control} name="estimatedDurationMinutes" render={({ field }) => <DurationInput id="estimatedDurationMinutes" value={Number.isFinite(field.value) ? field.value : null} onChange={(v) => field.onChange(v ?? Number.NaN)} invalid={!!errors.estimatedDurationMinutes} />} />
        </FormField>
        <FormField label="Preferred Time" htmlFor="preferredTime" error={errors.preferredTime?.message}><Select id="preferredTime" {...register('preferredTime')}><Options values={PREFERRED_TIME} /></Select></FormField>
        <div className="sm:col-span-2 space-y-3 rounded-lg bg-surface-2 p-3">
          <Checkbox id="isSplittable" label="This task can be split into several sessions" {...register('isSplittable')} />
          {splittable && <FormField label="Minimum Session" htmlFor="minimumSessionMinutes" error={errors.minimumSessionMinutes?.message} hint="The shortest useful session. Must not exceed the estimated duration.">
            <Controller control={control} name="minimumSessionMinutes" render={({ field }) => <DurationInput id="minimumSessionMinutes" value={field.value} onChange={field.onChange} invalid={!!errors.minimumSessionMinutes} presets={false} />} />
          </FormField>}
        </div>
        <FormField label="Status" htmlFor="status" error={errors.status?.message}><Select id="status" {...register('status')}><Options values={TASK_STATUS} /></Select></FormField>
      </form>
    </Modal>
  );
}
