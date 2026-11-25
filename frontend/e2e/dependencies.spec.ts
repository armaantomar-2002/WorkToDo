import { expect, test } from '@playwright/test';
import { addTask, register } from './helpers';

test.describe('task dependencies', () => {
  test('link tasks, see Blocked, complete the prerequisite, see it unblocked; cycles are refused', async ({ page }) => {
    await register(page); await addTask(page, 'Write draft'); await addTask(page, 'Publish article');
    await page.goto('/tasks'); await page.getByRole('button', { name: 'View Publish article' }).click(); const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Add a prerequisite').selectOption({ label: 'Write draft (Pending)' }); await dialog.getByRole('button', { name: 'Add dependency' }).click();
    await expect(dialog.getByText('Write draft')).toBeVisible(); await expect(dialog.getByText('Blocked').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click(); await expect(page.getByText('Blocked', { exact: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'View Write draft' }).click(); await page.getByRole('dialog').getByLabel('Add a prerequisite').selectOption({ label: 'Publish article (Pending)' });
    await page.getByRole('dialog').getByRole('button', { name: 'Add dependency' }).click(); await expect(page.getByText('circular dependency')).toBeVisible();   // toast from the server
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    await page.getByLabel('Mark Write draft completed').check(); await page.reload();
    await expect(page.getByText('Blocked', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'View Publish article' }).click(); await expect(page.getByRole('dialog').getByText('Ready')).toBeVisible();
  });
});
