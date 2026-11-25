import { expect, test } from '@playwright/test';
import { PASSWORD, register, uniqueEmail } from './helpers';

test.describe('authentication', () => {
  test('protected pages redirect anonymous visitors to login', async ({ page }) => {
    for (const path of ['/dashboard', '/tasks', '/recommendations', '/sessions', '/insights', '/settings']) { await page.goto(path); await expect(page).toHaveURL(/\/login/); }
  });
  test('register -> dashboard -> refresh keeps the session -> logout -> login', async ({ page }) => {
    const email = await register(page, 'Armaan Test');
    await expect(page.getByText(/Good (morning|afternoon|evening), Armaan/)).toBeVisible();
    await page.reload();                                   // access token is in memory: this proves the HttpOnly refresh cookie works
    await expect(page).toHaveURL(/\/dashboard/); await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await page.goto('/settings?tab=security'); await page.getByRole('button', { name: 'Log out' }).click(); await expect(page).toHaveURL(/\/login/);
    await page.goto('/dashboard'); await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email Address').fill(email); await page.getByLabel('Password', { exact: true }).fill(PASSWORD); await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });
  test('wrong password and duplicate email show errors', async ({ page }) => {
    const email = await register(page); await page.goto('/settings?tab=security'); await page.getByRole('button', { name: 'Log out' }).click();
    await page.getByLabel('Email Address').fill(email); await page.getByLabel('Password', { exact: true }).fill('Wrong12345'); await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
    await page.goto('/register'); await page.getByLabel('Full Name').fill('Dup'); await page.getByLabel('Email Address').fill(email); await page.getByLabel('Password', { exact: true }).fill(PASSWORD); await page.getByLabel('Confirm Password').fill(PASSWORD); await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('An account with this email already exists')).toBeVisible();
  });
  test('register form validates client-side', async ({ page }) => {
    await page.goto('/register'); await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Full name is required')).toBeVisible(); await expect(page.getByText('Email is required')).toBeVisible();
    await page.getByLabel('Full Name').fill('X'); await page.getByLabel('Email Address').fill(uniqueEmail()); await page.getByLabel('Password', { exact: true }).fill('Password123'); await page.getByLabel('Confirm Password').fill('Different123'); await page.getByRole('button', { name: 'Create Account' }).click();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });
  test('forgot password is non-enumerating and does not claim delivery', async ({ page }) => {
    await page.goto('/forgot-password'); await page.getByLabel('Email Address').fill('nobody@example.com'); await page.getByRole('button', { name: 'Send Reset Link' }).click();
    await expect(page.getByText(/Email delivery is not configured/)).toBeVisible();
  });
});
