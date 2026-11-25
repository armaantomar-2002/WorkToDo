import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { AuthLayout, AuthLink } from '../components/layout/PublicLayout';
import { Alert, Button, FormField, PasswordInput, PasswordStrength } from '../components/ui';
import { api, messageOf } from '../lib/api';

const schema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128).refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number'),
  confirmPassword: z.string().min(1, 'Confirm your password'),
}).refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { newPassword: '', confirmPassword: '' } });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try { await api.post('/auth/reset-password', { token, newPassword: v.newPassword }, { auth: false }); setDone(true); } catch (e) { setError(messageOf(e)); }
  });
  return (
    <AuthLayout title="Choose a New Password" subtitle="Pick a strong password you haven't used before." variant="a" footer={<AuthLink to="/login">Back to Log In</AuthLink>}>
      {!token ? <Alert tone="error">This reset link is missing its token. Request a new link from the “Forgot password?” page.</Alert>
        : done ? <Alert tone="success">Your password has been changed and all devices were signed out. You can now <AuthLink to="/login">log in</AuthLink>.</Alert> : (
          <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Choose a new password">
            {error && <Alert tone="error">{error}</Alert>}
            <FormField label="New Password" htmlFor="newPassword" error={errors.newPassword?.message}><PasswordInput id="newPassword" icon={Lock} autoComplete="new-password" invalid={!!errors.newPassword} {...register('newPassword')} /><PasswordStrength password={watch('newPassword')} /></FormField>
            <FormField label="Confirm Password" htmlFor="confirmPassword" error={errors.confirmPassword?.message}><PasswordInput id="confirmPassword" icon={Lock} autoComplete="new-password" invalid={!!errors.confirmPassword} {...register('confirmPassword')} /></FormField>
            <Button type="submit" block loading={isSubmitting}>Change Password</Button>
          </form>
        )}
    </AuthLayout>
  );
}
