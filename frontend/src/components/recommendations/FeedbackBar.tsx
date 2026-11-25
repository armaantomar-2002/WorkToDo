import { useState } from 'react';
import { MessageSquare, ThumbsDown, ThumbsUp, CheckCheck, Ban } from 'lucide-react';
import { Button, useToast } from '../ui';
import { useClearFeedback, useSaveFeedback } from '../../api/hooks';
import { messageOf } from '../../lib/api';
import { cn } from '../../lib/cn';
import { FEEDBACK_LABEL, type Feedback, type FeedbackType } from '../../lib/types';

const ICON = { helpful: ThumbsUp, not_helpful: ThumbsDown, already_done: CheckCheck, not_relevant: Ban } as const;
const TYPES = Object.keys(FEEDBACK_LABEL) as FeedbackType[];
const MAX_COMMENT = 500;

/** Saves feedback for one recommended item to the database (one entry per item; re-clicking another option replaces it). */
export function FeedbackBar({ runId, itemId, taskName, initial }: { runId: string; itemId: string; taskName: string; initial: Feedback | null }) {
  const save = useSaveFeedback(); const clear = useClearFeedback(); const toast = useToast();
  const [saved, setSaved] = useState<Feedback | null>(initial);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(initial?.comment ?? '');
  const busy = save.isPending || clear.isPending;

  const submit = (feedbackType: FeedbackType, comment: string | null) => save.mutate({ runId, itemId, feedbackType, comment }, {
    onSuccess: (f) => { setSaved(f); setNote(f.comment ?? ''); toast.success('Feedback saved'); },
    onError: (e) => toast.error(messageOf(e)),
  });
  const onClear = () => clear.mutate({ runId, itemId }, { onSuccess: () => { setSaved(null); setNote(''); setNoteOpen(false); toast.success('Feedback removed'); }, onError: (e) => toast.error(messageOf(e)) });

  return (
    <div className="mt-4 border-t border-line pt-3" role="group" aria-label={`Feedback on the recommendation for ${taskName}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">Was this useful?</span>
        {TYPES.map((t) => {
          const Icon = ICON[t]; const on = saved?.feedbackType === t;
          return (
            <button key={t} type="button" aria-pressed={on} disabled={busy} onClick={() => submit(t, note.trim() || null)}
              className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-60', on ? 'border-olive bg-olive-soft text-olive-ink' : 'border-line bg-surface hover:bg-surface-2')}>
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />{FEEDBACK_LABEL[t]}
            </button>);
        })}
        <button type="button" onClick={() => setNoteOpen((o) => !o)} aria-expanded={noteOpen} className="inline-flex items-center gap-1 text-xs font-medium text-terracotta hover:underline"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{saved?.comment ? 'Edit note' : 'Add note'}</button>
        {saved && <button type="button" onClick={onClear} disabled={busy} className="text-xs text-muted hover:text-ink hover:underline">Clear</button>}
        {saved && <span className="text-xs text-olive-ink" role="status">Saved</span>}
      </div>
      {noteOpen && (
        <div className="mt-2 space-y-2">
          <label htmlFor={`fb-${itemId}`} className="sr-only">Feedback note</label>
          <textarea id={`fb-${itemId}`} className="field-input min-h-[72px]" maxLength={MAX_COMMENT} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (what worked or did not?)" />
          <div className="flex items-center justify-between"><span className="text-xs text-muted">{note.length}/{MAX_COMMENT}</span>
            <Button size="sm" disabled={busy || !saved} loading={save.isPending} onClick={() => saved && submit(saved.feedbackType, note.trim() || null)}>Save note</Button></div>
          {!saved && <p className="text-xs text-muted">Choose an option above first; the note is saved with it.</p>}
        </div>)}
    </div>
  );
}
