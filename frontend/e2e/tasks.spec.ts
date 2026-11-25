import { expect, test } from '@playwright/test';
import { addTask, register } from './helpers';

test.describe('tasks', () => {
  test('create, search, edit, complete, reopen and delete persist across reloads', async ({ page }) => {
    await register(page);
    await page.goto('/tasks'); await expect(page.getByText('No tasks yet')).toBeVisible();
    await addTask(page, 'Write report', { importance: 'Critical', due: '2030-01-15' }); await addTask(page, 'Gym session', { importance: 'Low' });
    await page.reload(); await expect(page.getByRole('button', { name: 'Write report', exact: true }).first()).toBeVisible();
    await expect(page.getByText('Jan 15, 2030')).toBeVisible();

    await page.getByLabel('Search tasks').fill('gym'); await expect(page.getByRole('button', { name: 'Write report', exact: true })).toHaveCount(0); await page.getByLabel('Search tasks').fill('');

    await page.getByRole('button', { name: 'Edit Gym session' }).click(); const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Task Name').fill('Gym workout'); await dialog.getByRole('button', { name: 'Save Changes' }).click(); await expect(page.getByRole('button', { name: 'Gym workout', exact: true }).first()).toBeVisible();

    await page.getByLabel('Mark Gym workout completed').check(); await page.getByRole('tab', { name: /Completed/ }).click(); await expect(page.getByRole('button', { name: 'Gym workout', exact: true }).first()).toBeVisible();
    await page.getByLabel('Reopen Gym workout').uncheck(); await page.getByRole('tab', { name: /Pending/ }).click(); await expect(page.getByRole('button', { name: 'Gym workout', exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Delete Gym workout' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Gym workout', exact: true })).toHaveCount(0);
    await page.reload(); await expect(page.getByRole('button', { name: 'Gym workout', exact: true })).toHaveCount(0);
  });
  test('form validation: required name, splittable minimum session, due before start', async ({ page }) => {
    await register(page); await page.goto('/tasks'); await page.getByRole('button', { name: 'Add Task' }).first().click(); const d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'Create Task' }).click(); await expect(d.getByText('Task name is required')).toBeVisible();
    await d.getByLabel('Task Name').fill('X'); await d.getByLabel('This task can be split into several sessions').check(); await d.getByRole('button', { name: 'Create Task' }).click(); await expect(d.getByText('Required for splittable tasks')).toBeVisible();
    await d.locator('#minimumSessionMinutes-minutes').fill('10'); await d.getByLabel('Start Date').fill('2030-02-02'); await d.getByLabel('Due Date').fill('2030-02-01'); await d.getByRole('button', { name: 'Create Task' }).click(); await expect(d.getByText('Due date cannot be before the start date')).toBeVisible();
  });
});
