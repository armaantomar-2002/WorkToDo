import { expect, type Page } from '@playwright/test';

export const uniqueEmail = (tag = 'e2e') => `${tag}.${Date.now()}.${Math.floor(Math.random() * 1e6)}@example.com`;
export const PASSWORD = 'Password123';

export async function register(page: Page, fullName = 'E2E User', email = uniqueEmail()) {
  await page.goto('/register');
  await page.getByLabel('Full Name').fill(fullName);
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Confirm Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}

export async function addTask(page: Page, name: string, opts: { importance?: string; due?: string } = {}) {
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Add Task' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Task Name').fill(name);
  if (opts.importance) await dialog.getByLabel('Importance').selectOption(opts.importance);
  if (opts.due) await dialog.getByLabel('Due Date').fill(opts.due);
  await dialog.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('button', { name: name, exact: true }).first()).toBeVisible();
}
