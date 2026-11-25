import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Mail } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { AuthLayout, AuthLink } from '../components/layout/PublicLayout';
import { Alert, Button, Checkbox, FormField, Input, PasswordInput } from '../components/ui';
import { useAuth } from '../auth/AuthContext';
import { messageOf } from '../lib/api';

const schema = z.object({ email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'), password: z.string().min(1, 'Password is required'), rememberMe: z.boolean() });
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { login, bootstrapError } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '', rememberMe: false } });

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try { await login(v.email, v.password, v.rememberMe); navigate(from, { replace: true }); }
    catch (e) { setFormError(messageOf(e)); }
  });

  return (
    <AuthLayout title="Welcome Back" subtitle="Log in to continue to your workspace." variant="b"
      footer={<>Don't have an account? <AuthLink to="/register">Register</AuthLink></>}>
      <form onSubmit={onSubmit} noValidate className="space-y-4" aria-label="Log in">
        {(formError || bootstrapError) && <Alert tone="error">{formError ?? bootstrapError}</Alert>}
        <FormField label="Email Address" htmlFor="email" error={errors.email?.message}><Input id="email" type="email" icon={Mail} autoComplete="email" placeholder="Email Address" invalid={!!errors.email} {...register('email')} /></FormField>
        <FormField label="Password" htmlFor="password" error={errors.password?.message}><PasswordInput id="password" icon={Lock} autoComplete="current-password" placeholder="Password" invalid={!!errors.password} {...register('password')} /></FormField>
        <div className="flex items-center justify-between">
          <Checkbox id="rememberMe" label="Remember me" {...register('rememberMe')} />
          <Link to="/forgot-password" className="text-sm font-semibold text-terracotta hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" block loading={isSubmitting}>Log In</Button>
      </form>
    </AuthLayout>
  );
}
