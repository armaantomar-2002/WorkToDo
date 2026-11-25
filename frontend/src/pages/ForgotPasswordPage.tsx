import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail } from 'lucide-react';
import { AuthLayout, AuthLink } from '../components/layout/PublicLayout';
import { Alert, Button, FormField, Input } from '../components/ui';
import { api, messageOf } from '../lib/api';

const schema = z.object({ email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address') });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try { await api.post('/auth/forgot-password', v, { auth: false }); setDone(true); } catch (e) { setError(messageOf(e)); }
  });
  return (
    <AuthLayout title="Reset Password" subtitle="Enter your email and we'll prepare a reset link." variant="b" footer={<>Remembered it? <AuthLink to="/login">Log In</AuthLink></>}>
      {done ? (
        <Alert tone="info">
          If an account exists for that email, a reset link has been prepared. <strong>Email delivery is not configured in this build</strong>: in development the link is printed in the backend server console; in other environments an administrator must enable a delivery provider.
        </Alert>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Request password reset">
          {error && <Alert tone="error">{error}</Alert>}
          <FormField label="Email Address" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" icon={Mail} autoComplete="email" placeholder="Email Address" invalid={!!errors.email} {...register('email')} /></FormField>
          <Button type="submit" block loading={isSubmitting}>Send Reset Link</Button>
        </form>
      )}
    </AuthLayout>
  );
}
