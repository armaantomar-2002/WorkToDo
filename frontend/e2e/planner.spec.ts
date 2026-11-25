// Planner end-to-end flow against the real backend. NOT executed in the authoring sandbox (no Playwright/browsers) — run with `npm run e2e`.
import { expect, test } from '@playwright/test';
import { addTask, register } from './helpers';

const tomorrow = () => { const d = new Date(Date.now() + 86400000); return d.toISOString().slice(0, 10); };

test.describe('planner', () => {
  test('appointment -> draft -> approve; draft changes never touch the active schedule; month tooltip; postpone', async ({ page }) => {
    await register(page);
    await addTask(page, 'Write report', { importance: 'High', due: '2030-01-15' }); await addTask(page, 'Read chapter', { importance: 'Medium' });

    await page.goto('/planner?view=week');
    await expect(page.getByRole('heading', { name: 'Planner' })).toBeVisible();
    await page.getByRole('button', { name: 'Appointment' }).click();
    const dlg = page.getByRole('dialog'); await dlg.getByLabel('Title').fill('Dentist');
    await dlg.getByLabel('Starts').fill(`${tomorrow()}T11:00`); await dlg.getByLabel('Ends').fill(`${tomorrow()}T12:00`);
    await dlg.getByRole('button', { name: 'Add appointment' }).click(); await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: /Appointment Dentist/ })).toBeVisible();

    // overlapping appointment is rejected by the server and the dialog stays open with the reason
    await page.getByRole('button', { name: 'Appointment' }).click();
    await page.getByRole('dialog').getByLabel('Title').fill('Clash');
    await page.getByRole('dialog').getByLabel('Starts').fill(`${tomorrow()}T11:30`); await page.getByRole('dialog').getByLabel('Ends').fill(`${tomorrow()}T12:30`);
    await page.getByRole('dialog').getByRole('button', { name: 'Add appointment' }).click();
    await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible(); await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Generate schedule' }).click();
    await expect(page.getByRole('region', { name: 'Draft schedule' })).toBeVisible();
    await expect(page.getByText('not active yet')).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click(); await expect(page.getByRole('region', { name: 'Draft schedule' })).toHaveCount(0);
    await page.reload(); await expect(page.getByRole('region', { name: 'Week calendar' })).toBeVisible();

    // reject keeps the approved schedule
    await page.getByRole('button', { name: 'Re-plan' }).click(); await expect(page.getByRole('region', { name: 'Draft schedule' })).toBeVisible();
    await page.getByRole('button', { name: 'Reject' }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Reject draft' }).click();
    await expect(page.getByRole('region', { name: 'Draft schedule' })).toHaveCount(0); await expect(page.getByText('Schedule history')).toBeVisible();

    // month view: hover tooltip on desktop, tap dialog
    await page.getByRole('tab', { name: 'Month' }).click(); const cell = page.getByTestId(`month-${tomorrow()}`);
    await cell.hover(); await expect(page.getByRole('tooltip')).toContainText('Dentist');
    await cell.click(); await expect(page.getByRole('dialog')).toContainText('Dentist'); await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    // postpone with history
    await page.goto('/tasks'); await page.getByRole('button', { name: 'Postpone Read chapter' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Postpone' }).click(); await expect(page.getByText(/Postponed until/)).toBeVisible();
  });

  test('availability settings validate and persist; mobile layout stays usable', async ({ page }) => {
    await register(page);
    await page.goto('/settings?tab=availability');
    await page.getByLabel('Day ends').fill('08:00'); await page.getByRole('button', { name: 'Save availability' }).click(); await expect(page.getByText('must end after', { exact: false }).or(page.getByText('end after it starts'))).toBeVisible();
    await page.getByLabel('Day ends').fill('17:00'); await page.getByRole('button', { name: 'Save availability' }).click(); await expect(page.getByText('Availability saved')).toBeVisible();
    await page.reload(); await expect(page.getByLabel('Day ends')).toHaveValue('17:00');
    await page.setViewportSize({ width: 390, height: 800 }); await page.goto('/planner?view=day');
    await expect(page.getByRole('region', { name: 'Day calendar' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
