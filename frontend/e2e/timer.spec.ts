import { expect, test } from '@playwright/test';
import { addTask, register } from './helpers';

const secs = async (loc: import('@playwright/test').Locator) => { const [m, s] = (await loc.innerText()).split(':').map(Number); return m * 60 + s; };

test.describe('persistent focus timer', () => {
  test('start -> navigate away -> refresh -> pause -> resume -> finish; history shows planned vs actual', async ({ page }) => {
    await register(page, 'Timer User'); await addTask(page, 'Deep work');
    await page.goto('/sessions'); await page.getByLabel('Task (optional)').selectOption({ label: 'Deep work' }); await page.getByLabel('Planned (minutes)').fill('25'); await page.getByRole('button', { name: /Start Focus/ }).click();
    const panel = page.getByTestId('active-timer'); await expect(panel).toBeVisible(); await expect(panel.getByText('Running')).toBeVisible();

    await page.waitForTimeout(2500); const before = await secs(page.getByTestId('timer-elapsed')); expect(before).toBeGreaterThanOrEqual(2);
    await page.goto('/dashboard'); await expect(page.getByTestId('active-timer-banner')).toBeVisible();        // navigation does not stop it
    await page.reload(); await page.goto('/sessions'); await expect(page.getByTestId('active-timer')).toBeVisible();
    expect(await secs(page.getByTestId('timer-elapsed'))).toBeGreaterThanOrEqual(before);                      // elapsed continued on the server

    await page.getByRole('button', { name: /Pause/ }).click(); await expect(page.getByText('Paused', { exact: true })).toBeVisible();
    const paused = await secs(page.getByTestId('timer-elapsed')); await page.waitForTimeout(2200); expect(await secs(page.getByTestId('timer-elapsed'))).toBe(paused);
    await page.reload(); await expect(page.getByText('Paused', { exact: true })).toBeVisible(); expect(await secs(page.getByTestId('timer-elapsed'))).toBe(paused);   // still paused and unchanged after a refresh

    await page.getByRole('button', { name: /Resume/ }).click(); await expect(page.getByText('Running')).toBeVisible(); await page.waitForTimeout(1500);
    await page.getByRole('button', { name: /^Finish$/ }).click(); await page.getByRole('dialog').getByLabel(/Also mark/).check(); await page.getByRole('dialog').getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByTestId('active-timer')).toHaveCount(0); const row = page.getByTestId('timer-history-row').first();
    await expect(row).toContainText('Deep work'); await expect(row).toContainText('Finished'); await expect(row).toContainText('25 min'); await expect(row).toContainText('1 pause'.replace('1 pause', '1×'));
    await page.goto('/tasks?tab=completed'); await expect(page.getByRole('button', { name: 'Deep work', exact: true })).toBeVisible();
  });

  test('a second timer cannot be started while one is active (also from another tab)', async ({ page, context }) => {
    await register(page); await page.goto('/sessions'); await page.getByRole('button', { name: /Start Focus/ }).click(); await expect(page.getByTestId('active-timer')).toBeVisible();
    const other = await context.newPage(); await other.goto('/sessions'); await expect(other.getByTestId('active-timer')).toBeVisible(); await expect(other.getByRole('button', { name: /Start Focus/ })).toHaveCount(0);
    await other.getByRole('button', { name: /Pause/ }).click(); await expect(other.getByText('Paused', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Pause/ }).click();                                                  // stale tab: the server says 409 and the UI re-syncs
    await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  });

  test('cancelling keeps the entry in history as Cancelled', async ({ page }) => {
    await register(page); await page.goto('/sessions'); await page.getByRole('button', { name: /Start Focus/ }).click(); await page.waitForTimeout(1200);
    await page.getByRole('button', { name: /^Cancel$/ }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Cancel timer' }).click();
    await expect(page.getByTestId('timer-history-row').first()).toContainText('Cancelled');
  });
});
