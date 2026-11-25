import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Mail, User } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout, AuthLink } from '../components/layout/PublicLayout';
import { Alert, Button, FormField, Input, PasswordInput, PasswordStrength } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { ApiError, fieldErrorsOf, messageOf } from '../lib/api';

export const registerSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(120, 'Full name must be at most 120 characters'),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address').max(254),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password must be at most 128 characters').refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain a letter and a number'),
  confirmPassword: z.string().min(1, 'Confirm your password'),
}).refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });
type Values = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const { register: signUp } = useAuth();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, watch, setError, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(registerSchema), defaultValues: { fullName: '', email: '', password: '', confirmPassword: '' } });
  const password = watch('password');

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try { await signUp(v.fullName, v.email, v.password); navigate('/dashboard', { replace: true }); }
    catch (e) {
      const fields = fieldErrorsOf(e);
      let handled = false;
      for (const f of ['fullName', 'email', 'password'] as const) if (fields[f]) { setError(f, { message: fields[f] }); handled = true; }
      if (e instanceof ApiError && e.code === 'email_taken') { setError('email', { message: e.message }); handled = true; }
      if (!handled) setFormError(messageOf(e));
    }
  });

  return (
    <AuthLayout title="Create Your Account" subtitle="Get started with WorkToDo in a few steps." variant="a"
      footer={<>Already have an account? <AuthLink to="/login">Log In</AuthLink></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Create account">
        {formError && <Alert tone="error">{formError}</Alert>}
        <FormField label="Full Name" htmlFor="fullName" error={errors.fullName?.message}><Input id="fullName" icon={User} autoComplete="name" placeholder="Full Name" invalid={!!errors.fullName} {...register('fullName')} /></FormField>
        <FormField label="Email Address" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" icon={Mail} autoComplete="email" placeholder="Email Address" invalid={!!errors.email} {...register('email')} /></FormField>
        <FormField label="Password" htmlFor="password" error={errors.password?.message}>
          <PasswordInput id="password" icon={Lock} autoComplete="new-password" placeholder="Password" invalid={!!errors.password} {...register('password')} />
          <PasswordStrength password={password} />
        </FormField>
        <FormField label="Confirm Password" htmlFor="confirmPassword" error={errors.confirmPassword?.message}><PasswordInput id="confirmPassword" icon={Lock} autoComplete="new-password" placeholder="Confirm Password" invalid={!!errors.confirmPassword} {...register('confirmPassword')} /></FormField>
        <Button type="submit" block loading={isSubmitting}>Create Account</Button>
      </form>
    </AuthLayout>
  );
}
