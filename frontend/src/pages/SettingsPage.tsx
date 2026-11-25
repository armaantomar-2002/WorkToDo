import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import { PageHeader } from '../components/layout/AppShell';
import { Alert, Badge, Button, Card, CardHeader, ConfirmDialog, ErrorState, FormField, Input, PasswordInput, PasswordStrength, PillTabs, Select, Skeleton, useToast } from '../components/ui';
import { useAuthSessions, useChangePassword, usePreferences, useRevokeAuthSession, useRevokeOtherSessions, useUpdatePreferences, useUpdateProfile } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../theme/ThemeProvider';
import { AvailabilityTab } from '../components/planner/AvailabilityTab';
import { fieldErrorsOf, messageOf } from '../lib/api';
import { formatInstant } from '../lib/format';
import { LEVEL, TIME_PERIOD, type Preferences } from '../lib/types';

type Tab = 'profile' | 'security' | 'preferences' | 'availability';

const profileSchema = z.object({ fullName: z.string().trim().min(1, 'Full name is required').max(120), email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'), currentPassword: z.string() });
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileTab() {
  const { user, setUser } = useAuth(); const update = useUpdateProfile(); const toast = useToast();
  const [error, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, watch, reset, setError, formState: { errors, isSubmitting } } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { fullName: user?.fullName ?? '', email: user?.email ?? '', currentPassword: '' } });
  const emailChanged = watch('email').trim().toLowerCase() !== (user?.email ?? '');
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    if (emailChanged && !v.currentPassword) { setError('currentPassword', { message: 'Enter your current password to change your email' }); return; }
    try {
      const next = await update.mutateAsync({ fullName: v.fullName, ...(emailChanged ? { email: v.email, currentPassword: v.currentPassword } : {}) });
      setUser(next); reset({ fullName: next.fullName, email: next.email, currentPassword: '' }); toast.success('Profile updated');
    } catch (e) {
      const f = fieldErrorsOf(e); let handled = false;
      for (const k of ['fullName', 'email'] as const) if (f[k]) { setError(k, { message: f[k] }); handled = true; }
      if (!handled) { const msg = messageOf(e); if (/password/i.test(msg)) setError('currentPassword', { message: msg }); else if (/email/i.test(msg)) setError('email', { message: msg }); else setFormError(msg); }
    }
  });
  return (
    <Card><CardHeader title="Profile Information" />
      <form onSubmit={onSubmit} noValidate className="max-w-lg space-y-4 px-5 pb-5 pt-4" aria-label="Profile">
        {error && <Alert tone="error">{error}</Alert>}
        <FormField label="Full Name" htmlFor="fullName" error={errors.fullName?.message}><Input id="fullName" invalid={!!errors.fullName} {...register('fullName')} /></FormField>
        <FormField label="Email Address" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" invalid={!!errors.email} {...register('email')} /></FormField>
        {emailChanged && <FormField label="Current Password" htmlFor="currentPassword" error={errors.currentPassword?.message} hint="Required to change your email address."><PasswordInput id="currentPassword" autoComplete="current-password" invalid={!!errors.currentPassword} hasHint {...register('currentPassword')} /></FormField>}
        <Button type="submit" loading={isSubmitting}>Update Profile</Button>
      </form></Card>
  );
}

const pwSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128).refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number'),
  confirmPassword: z.string().min(1, 'Confirm your new password'),
}).refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' })
  .refine((d) => d.currentPassword !== d.newPassword, { path: ['newPassword'], message: 'New password must be different from the current one' });
type PwValues = z.infer<typeof pwSchema>;

function SecurityTab() {
  const { logout } = useAuth(); const change = useChangePassword(); const toast = useToast(); const navigate = useNavigate();
  const sessions = useAuthSessions(); const revoke = useRevokeAuthSession(); const revokeOthers = useRevokeOtherSessions();
  const [confirmOthers, setConfirmOthers] = useState(false);
  const [error, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, watch, reset, setError, formState: { errors, isSubmitting } } = useForm<PwValues>({ resolver: zodResolver(pwSchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });
  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try { await change.mutateAsync({ currentPassword: v.currentPassword, newPassword: v.newPassword }); reset(); toast.success('Password changed. Other devices were signed out.'); sessions.refetch(); }
    catch (e) { const f = fieldErrorsOf(e); if (f.newPassword) setError('newPassword', { message: f.newPassword }); else if (/current password/i.test(messageOf(e))) setError('currentPassword', { message: messageOf(e) }); else setFormError(messageOf(e)); }
  });
  const doLogout = async () => { await logout(); navigate('/login', { replace: true }); };
  return (
    <div className="space-y-6">
      <Card><CardHeader title="Change Password" />
        <form onSubmit={onSubmit} noValidate className="max-w-lg space-y-4 px-5 pb-5 pt-4" aria-label="Change password">
          {error && <Alert tone="error">{error}</Alert>}
          <FormField label="Current Password" htmlFor="currentPassword" error={errors.currentPassword?.message}><PasswordInput id="currentPassword" autoComplete="current-password" invalid={!!errors.currentPassword} {...register('currentPassword')} /></FormField>
          <FormField label="New Password" htmlFor="newPassword" error={errors.newPassword?.message}><PasswordInput id="newPassword" autoComplete="new-password" invalid={!!errors.newPassword} {...register('newPassword')} /><PasswordStrength password={watch('newPassword')} /></FormField>
          <FormField label="Confirm New Password" htmlFor="confirmPassword" error={errors.confirmPassword?.message}><PasswordInput id="confirmPassword" autoComplete="new-password" invalid={!!errors.confirmPassword} {...register('confirmPassword')} /></FormField>
          <Button type="submit" loading={isSubmitting}>Change Password</Button>
        </form></Card>

      <Card><CardHeader title="Session Management" action={<Button variant="secondary" size="sm" onClick={() => setConfirmOthers(true)} disabled={!sessions.data || sessions.data.length < 2}>Sign out other devices</Button>} />
        <div className="px-5 pb-5 pt-3">
          {sessions.isPending ? <Skeleton className="h-16" /> : sessions.isError ? <ErrorState message={messageOf(sessions.error)} onRetry={() => sessions.refetch()} /> : (
            <ul className="divide-y divide-line">{sessions.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div className="flex min-w-0 items-start gap-3"><MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" /><div className="min-w-0"><p className="truncate font-medium">{s.userAgent ?? 'Unknown device'} {s.current && <Badge tone="olive" className="ml-1">This device</Badge>}</p><p className="text-xs text-muted">Last active {formatInstant(s.lastUsedAt)} · expires {formatInstant(s.expiresAt)}{s.rememberMe ? ' · remembered' : ''}</p></div></div>
                {!s.current && <Button variant="secondary" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id, { onSuccess: () => toast.success('Session signed out'), onError: (e) => toast.error(messageOf(e)) })}>Sign out</Button>}
              </li>))}</ul>)}
        </div></Card>

      <Card><CardHeader title="Log out" /><div className="px-5 pb-5 pt-3"><p className="mb-3 text-sm text-muted">End your session on this device.</p><Button variant="secondary" onClick={doLogout}><LogOut className="h-4 w-4" aria-hidden="true" />Log out</Button></div></Card>
      <ConfirmDialog open={confirmOthers} title="Sign out other devices?" message="Every other signed-in device will need to log in again." confirmLabel="Sign out others" loading={revokeOthers.isPending}
        onCancel={() => setConfirmOthers(false)} onConfirm={() => revokeOthers.mutate(undefined, { onSuccess: (r) => { toast.success(`Signed out ${r.revoked} ${r.revoked === 1 ? 'session' : 'sessions'}`); setConfirmOthers(false); }, onError: (e) => { toast.error(messageOf(e)); setConfirmOthers(false); } })} />
    </div>
  );
}

function PreferencesTab() {
  const prefs = usePreferences(); const update = useUpdatePreferences(); const toast = useToast(); const { setTheme } = useTheme();
  const { register, handleSubmit, reset, formState: { isSubmitting, isDirty } } = useForm<Preferences>();
  useEffect(() => { if (prefs.data) reset(prefs.data); }, [prefs.data, reset]);
  const zones = useMemo(() => {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    return Array.from(new Set(['UTC', ...list, ...(prefs.data ? [prefs.data.timeZone] : [])])).sort();
  }, [prefs.data]);
  if (prefs.isPending) return <Skeleton className="h-72" />;
  if (prefs.isError) return <Card><ErrorState message={messageOf(prefs.error)} onRetry={() => prefs.refetch()} /></Card>;
  const onSubmit = handleSubmit(async (v) => {
    try { const saved = await update.mutateAsync(v); setTheme(saved.themePreference); reset(saved); toast.success('Preferences saved'); } catch (e) { toast.error(messageOf(e)); }
  });
  return (
    <Card><CardHeader title="Preferences" />
      <form onSubmit={onSubmit} className="grid max-w-2xl gap-4 px-5 pb-5 pt-4 sm:grid-cols-2" aria-label="Preferences">
        <FormField label="Default Energy Level" htmlFor="defaultEnergyLevel"><Select id="defaultEnergyLevel" {...register('defaultEnergyLevel')}>{LEVEL.map((l) => <option key={l}>{l}</option>)}</Select></FormField>
        <FormField label="Default Focus Level" htmlFor="defaultFocusLevel"><Select id="defaultFocusLevel" {...register('defaultFocusLevel')}>{LEVEL.map((l) => <option key={l}>{l}</option>)}</Select></FormField>
        <FormField label="Preferred Time Period" htmlFor="preferredTimePeriod"><Select id="preferredTimePeriod" {...register('preferredTimePeriod')}>{TIME_PERIOD.map((l) => <option key={l}>{l}</option>)}</Select></FormField>
        <FormField label="Theme" htmlFor="themePreference"><Select id="themePreference" {...register('themePreference')}><option value="light">Light</option><option value="dark">Dark</option></Select></FormField>
        <FormField label="Notification Preference" htmlFor="notificationPreference" hint="Saved as your preference. Notification delivery is not implemented yet." className="sm:col-span-1"><Select id="notificationPreference" hasHint {...register('notificationPreference')}><option value="all">All</option><option value="important">Important only</option><option value="none">None</option></Select></FormField>
        <FormField label="Time Zone" htmlFor="timeZone" hint="Used to decide which calendar day your activity belongs to (dashboard and insights)."><Select id="timeZone" hasHint {...register('timeZone')}>{zones.map((z) => <option key={z}>{z}</option>)}</Select></FormField>
        <div className="sm:col-span-2"><Button type="submit" loading={isSubmitting} disabled={!isDirty}>Save Preferences</Button></div>
      </form></Card>
  );
}

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (['profile', 'security', 'preferences', 'availability'].includes(params.get('tab') ?? '') ? params.get('tab') : 'profile') as Tab;
  return (
    <>
      <PageHeader title="Settings" subtitle="Manage your account, preferences and application settings." />
      <div className="mb-5"><PillTabs<Tab> label="Settings sections" value={tab} onChange={(v) => setParams(v === 'profile' ? {} : { tab: v })} items={[{ value: 'profile', label: 'Profile' }, { value: 'security', label: 'Account & Security' }, { value: 'preferences', label: 'Preferences' }, { value: 'availability', label: 'Availability' }]} /></div>
      {tab === 'profile' && <ProfileTab />}{tab === 'security' && <SecurityTab />}{tab === 'preferences' && <PreferencesTab />}{tab === 'availability' && <AvailabilityTab />}
    </>
  );
}
