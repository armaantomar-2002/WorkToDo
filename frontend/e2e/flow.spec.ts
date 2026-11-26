import { expect, test } from '@playwright/test';
import { addTask, register } from './helpers';

// Needs the real Python ML service running on :8000 (the backend's ML_SERVICE_URL).
test.describe('focus sessions, recommendations, dashboard, insights, settings', () => {
  test('sessions persist and can feed a recommendation run; history reproduces the run; dashboard reflects it', async ({ page }) => {
    await register(page, 'Flow User');
    await addTask(page, 'Write report', { importance: 'Critical', due: '2030-01-15' }); await addTask(page, 'Gym session', { importance: 'Low' });

    await page.goto('/sessions'); await expect(page.getByText('No sessions yet')).toBeVisible();
    await page.getByLabel('Available Time (minutes)').fill('120'); await page.getByLabel('Longest Free Slot (minutes)').fill('90'); await page.getByRole('button', { name: 'Save Session' }).click();
    await expect(page.getByText('120 min ·')).toBeVisible(); await page.reload(); await expect(page.getByText('120 min ·')).toBeVisible();
    await page.getByLabel('Longest Free Slot (minutes)').fill('999'); await page.getByRole('button', { name: 'Save Session' }).click(); await expect(page.getByText('Cannot exceed the available time')).toBeVisible();

    await page.getByRole('button', { name: 'Use this session for recommendations' }).first().click(); await expect(page).toHaveURL(/\/recommendations\?session=/);
    await expect(page.getByLabel('Energy Level')).toBeDisabled();
    await page.getByRole('button', { name: 'Get Recommendations' }).click();
    // one schedule draft: every scheduled item shows an exact time interval, not a score
    const slots = page.getByTestId('timeline-item'); await expect(slots.first()).toBeVisible({ timeout: 20_000 });
    await expect(slots.first().getByTestId('time-interval')).toContainText(/\d{1,2}:\d{2} (AM|PM) – \d{1,2}:\d{2} (AM|PM)/); await expect(page.getByText(/Score: \d/)).toHaveCount(0);
    await page.getByText('Model ranking details & feedback').click();
    const items = page.getByTestId('ranked-item'); await expect(items).toHaveCount(2, { timeout: 20_000 }); await expect(items.first().getByText(/Do now|Do next|Schedule later/)).toBeVisible();
    const firstName = (await items.first().locator('h3').innerText()).trim();
    await expect(page.getByText(/Excluded Tasks \(0\)/)).toBeVisible();

    // feedback is saved to the database and is still there in history
    await items.first().getByRole('button', { name: /^Helpful/ }).click(); await expect(items.first().getByRole('button', { name: /^Helpful/ })).toHaveAttribute('aria-pressed', 'true');

    await page.getByRole('button', { name: 'History' }).click(); await page.getByText(/ranked \//).first().click();
    await expect(page.getByText(/Viewing a past run/)).toBeVisible(); await expect(page.getByTestId('ranked-item').first().locator('h3')).toHaveText(firstName);
    await expect(page.getByTestId('ranked-item').first().getByRole('button', { name: /^Helpful/ })).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/dashboard'); await expect(page.getByTestId('stat-Total Tasks')).toHaveText('2'); await expect(page.getByRole('heading', { name: firstName })).toBeVisible();
    await page.getByRole('button', { name: 'Start Task' }).click(); await expect(page).toHaveURL(/\/sessions\?task=/);
  });

  test('insights render real data with range filter and empty state for new accounts', async ({ page }) => {
    await register(page, 'Insight User'); await page.goto('/insights'); await expect(page.getByText('No data yet').first()).toBeVisible();
    await addTask(page, 'Done thing'); await page.getByLabel('Mark Done thing completed').check();
    await page.goto('/insights'); await expect(page.getByTestId('stat-Total Tasks')).toHaveText('1'); await expect(page.getByTestId('stat-Completion Rate')).toHaveText('100%');
    for (const label of ['Last 30 Days', 'Last 90 Days', 'Last 7 Days']) { await page.getByLabel('Time range').selectOption({ label }); await expect(page.getByRole('heading', { name: 'Task Completion Trend' })).toBeVisible(); }
    await expect(page.locator('.recharts-surface').first()).toBeVisible();
  });

  test('settings: profile, preferences (theme persists across reload), password change, session list', async ({ page }) => {
    await register(page, 'Settings User'); await page.goto('/settings');
    await page.getByLabel('Full Name').fill('Renamed User'); await page.getByRole('button', { name: 'Update Profile' }).click(); await expect(page.getByText('Profile updated')).toBeVisible(); await page.reload(); await expect(page.getByLabel('Full Name')).toHaveValue('Renamed User');
    await page.getByRole('tab', { name: 'Preferences' }).click(); await page.getByLabel('Theme').selectOption('dark'); await page.getByLabel('Default Energy Level').selectOption('High'); await page.getByRole('button', { name: 'Save Preferences' }).click(); await expect(page.getByText('Preferences saved')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('tab', { name: 'Account & Security' }).click(); await expect(page.getByText('This device')).toBeVisible();
    await page.getByLabel('Current Password', { exact: true }).fill('Password123'); await page.getByLabel('New Password', { exact: true }).fill('NewPassword456'); await page.getByLabel('Confirm New Password').fill('NewPassword456'); await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByText(/Password changed/)).toBeVisible();
  });

  test('two users never see each other\'s data', async ({ browser }) => {
    const a = await (await browser.newContext()).newPage(); const b = await (await browser.newContext()).newPage();
    await register(a, 'User A'); await addTask(a, 'Secret task of A'); await register(b, 'User B'); await b.goto('/tasks');
    await expect(b.getByRole('button', { name: 'Secret task of A' })).toHaveCount(0); await expect(b.getByText('No tasks yet')).toBeVisible();
  });
});

test.describe('public pages', () => {
  test('landing page content and navigation', async ({ page }) => {
    await page.goto('/'); await expect(page.getByRole('heading', { name: 'Know What to Do Next' })).toBeVisible();
    for (const t of ['Smart Recommendations', 'Stay Focused', 'Track Progress']) await expect(page.getByText(t)).toBeVisible();
    await page.getByRole('link', { name: /Get Started Free/ }).click(); await expect(page).toHaveURL(/\/register/);
    await page.goto('/this-page-does-not-exist'); await expect(page.getByText('Page not found')).toBeVisible();
  });
});
