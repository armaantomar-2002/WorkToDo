'use strict';
// DEVELOPMENT-ONLY seed data. Creates one clearly-labelled demo account with sample tasks and focus sessions.
// Refuses to run when NODE_ENV=production. Safe to re-run: it deletes and recreates only the demo account (and its data).
//   Run:  npm run db:seed        (also runs automatically after `npx prisma migrate reset`)
// Demo login:  demo@worktodo.local  /  value of SEED_DEMO_PASSWORD (default below; development only, never use for real accounts).
const DEMO_EMAIL = 'demo@worktodo.local';
const DEFAULT_DEMO_PASSWORD = 'DemoPassword123';
const RANK = { Critical: 1, High: 2, Medium: 3, Low: 4 };

const ymd = (d) => d.toISOString().slice(0, 10);
const plusDays = (n) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n); return d; };
const at = (n, hh, mm) => { const d = plusDays(n); d.setUTCHours(hh, mm, 0, 0); return d; }; // wall-clock labelled as UTC (TIMESTAMP(0) semantics)

function sampleTasks() {
  const t = (taskName, o) => ({
    taskName, description: null, startDate: null, dueDate: null, importance: 'Medium', goalContribution: 'Medium', consequenceOfDelay: 'Moderate', complexity: 'Moderate',
    estimatedDurationMinutes: 60, minimumSessionMinutes: null, isSplittable: false, preferredTime: 'Anytime', dependencyStatus: 'No dependency', status: 'Pending', ...o,
  });
  return [
    t('Finish quarterly report', { description: 'Compile figures and write the summary section.', importance: 'Critical', goalContribution: 'Essential', consequenceOfDelay: 'Major', complexity: 'Complex', estimatedDurationMinutes: 180, isSplittable: true, minimumSessionMinutes: 45, preferredTime: 'Morning', dueDate: plusDays(2), status: 'In Progress' }),
    t('Prepare presentation slides', { importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Significant', complexity: 'Moderate', estimatedDurationMinutes: 90, isSplittable: true, minimumSessionMinutes: 30, preferredTime: 'Afternoon', dueDate: plusDays(5) }),
    t('Reply to client emails', { importance: 'High', goalContribution: 'Medium', consequenceOfDelay: 'Moderate', complexity: 'Simple', estimatedDurationMinutes: 30, preferredTime: 'Morning', dueDate: plusDays(1) }),
    t('Review pull requests', { importance: 'Medium', goalContribution: 'Medium', consequenceOfDelay: 'Moderate', complexity: 'Moderate', estimatedDurationMinutes: 45, isSplittable: true, minimumSessionMinutes: 15, dueDate: plusDays(3) }),
    t('Plan next sprint', { importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Significant', complexity: 'Moderate', estimatedDurationMinutes: 60, preferredTime: 'Morning', dueDate: plusDays(7) }),
    t('Update project documentation', { importance: 'Low', goalContribution: 'Low', consequenceOfDelay: 'Minor', complexity: 'Simple', estimatedDurationMinutes: 40, preferredTime: 'Evening', dueDate: plusDays(14) }),
    t('Deploy release to staging', { importance: 'Critical', goalContribution: 'Essential', consequenceOfDelay: 'Major', complexity: 'Complex', estimatedDurationMinutes: 75, dueDate: plusDays(4) }),
    t('Book dentist appointment', { importance: 'Low', goalContribution: 'No linked goal', consequenceOfDelay: 'None', complexity: 'Simple', estimatedDurationMinutes: 10, preferredTime: 'Afternoon' }),
    t('Start next-month budget review', { importance: 'Medium', goalContribution: 'Medium', consequenceOfDelay: 'Minor', complexity: 'Moderate', estimatedDurationMinutes: 50, startDate: plusDays(10), dueDate: plusDays(20) }),
    t('Write onboarding guide', { importance: 'Medium', goalContribution: 'High', consequenceOfDelay: 'Minor', complexity: 'Moderate', estimatedDurationMinutes: 120, isSplittable: true, minimumSessionMinutes: 40, dueDate: plusDays(-1) }),
    // Completed history (spread over the last weeks so Insights has real data to chart)
    ...[[-1, 'Submit expense report', 'Low', 20], [-2, 'Fix login page bug', 'High', 60], [-4, 'Team retrospective notes', 'Medium', 30], [-6, 'Refactor API client', 'High', 120], [-9, 'Update dependencies', 'Medium', 45], [-13, 'Design database schema', 'Critical', 150], [-18, 'Set up CI pipeline', 'High', 90], [-25, 'Write unit tests for auth', 'Medium', 80]]
      .map(([day, name, importance, mins]) => t(name, { importance, estimatedDurationMinutes: mins, status: 'Completed', completedAt: at(day, 15, 30), createdAt: at(day - 3, 9, 0), dueDate: plusDays(day + 1) })),
    t('Old vendor evaluation', { importance: 'Low', goalContribution: 'Low', consequenceOfDelay: 'None', status: 'Cancelled' }),
  ];
}

function sampleSessions() {
  return [
    { sessionDateTime: at(0, 9, 0), availableTimeMinutes: 120, longestFreeSlotMinutes: 90, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' },
    { sessionDateTime: at(-1, 14, 0), availableTimeMinutes: 90, longestFreeSlotMinutes: 60, currentTimePeriod: 'Afternoon', energyLevel: 'Medium', focusLevel: 'Medium' },
    { sessionDateTime: at(-2, 19, 30), availableTimeMinutes: 60, longestFreeSlotMinutes: 45, currentTimePeriod: 'Evening', energyLevel: 'Low', focusLevel: 'Medium' },
    { sessionDateTime: at(-4, 8, 30), availableTimeMinutes: 150, longestFreeSlotMinutes: 120, currentTimePeriod: 'Morning', energyLevel: 'High', focusLevel: 'High' },
    { sessionDateTime: at(-7, 13, 0), availableTimeMinutes: 45, longestFreeSlotMinutes: 30, currentTimePeriod: 'Afternoon', energyLevel: 'Low', focusLevel: 'Low' },
    { sessionDateTime: at(-12, 10, 0), availableTimeMinutes: 100, longestFreeSlotMinutes: 80, currentTimePeriod: 'Morning', energyLevel: 'Medium', focusLevel: 'High' },
  ];
}

async function main() {
  if (String(process.env.NODE_ENV ?? '').trim() === 'production') {
    console.error('Refusing to seed: NODE_ENV is "production". Seed data is for development/test databases only.');
    process.exit(1);
  }
  const { PrismaClient } = require('@prisma/client');
  const argon2 = require('argon2');
  const prisma = new PrismaClient();
  try {
    const password = process.env.SEED_DEMO_PASSWORD || DEFAULT_DEMO_PASSWORD;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } }); // cascades to everything owned by the demo user
    const tasks = sampleTasks().map(({ createdAt, ...t }) => ({ ...t, ...(createdAt ? { createdAt } : {}), importanceRank: RANK[t.importance] }));
    const demo = await prisma.user.create({
      data: {
        fullName: 'Demo User (seed data)', email: DEMO_EMAIL, passwordHash, isEmailVerified: true,
        preferences: { create: { defaultEnergyLevel: 'Medium', defaultFocusLevel: 'Medium', preferredTimePeriod: 'Morning', themePreference: 'light', notificationPreference: 'important', timeZone: 'UTC' } },
        tasks: { create: tasks }, focusSessions: { create: sampleSessions() },
      },
    });
    // Real dependencies (the stored dependencyStatus is derived from them, exactly like the API does) and finished focus timers.
    const byName = Object.fromEntries((await prisma.task.findMany({ where: { userId: demo.id } })).map((x) => [x.taskName, x]));
    const edges = [['Deploy release to staging', 'Finish quarterly report'], ['Plan next sprint', 'Fix login page bug']];
    for (const [task, pre] of edges) await prisma.taskDependency.create({ data: { userId: demo.id, taskId: byName[task].id, dependsOnTaskId: byName[pre].id } });
    await prisma.task.update({ where: { id: byName['Deploy release to staging'].id }, data: { dependencyStatus: 'Blocked' } }); // prerequisite is still Pending
    await prisma.task.update({ where: { id: byName['Plan next sprint'].id }, data: { dependencyStatus: 'Ready' } });          // prerequisite is Completed
    const timers = [[0, 'Reply to client emails', 25, 22 * 60, 0], [-1, 'Finish quarterly report', 50, 47 * 60 + 30, 4 * 60], [-2, 'Review pull requests', 30, 30 * 60, 0], [-4, 'Prepare presentation slides', 45, 39 * 60, 3 * 60], [-7, 'Write onboarding guide', 60, 52 * 60, 8 * 60]];
    for (const [day, name, planned, focusedSec, pausedSec] of timers) {
      const startedAt = at(day, 10, 0); const endedAt = new Date(startedAt.getTime() + (focusedSec + pausedSec) * 1000);
      await prisma.focusTimer.create({ data: { userId: demo.id, taskId: byName[name].id, taskNameSnapshot: name, status: 'finished', plannedDurationMinutes: planned, startedAt, endedAt, actualFocusedSeconds: focusedSec, totalPausedSeconds: pausedSec,
        pauses: pausedSec ? { create: [{ pausedAt: new Date(startedAt.getTime() + 600000), resumedAt: new Date(startedAt.getTime() + 600000 + pausedSec * 1000) }] } : undefined } });
    }
    console.log(`Seeded demo account ${DEMO_EMAIL} with ${tasks.length} tasks and ${sampleSessions().length} focus sessions (dates relative to ${ymd(new Date())}).`);
    console.log(process.env.SEED_DEMO_PASSWORD ? 'Password: value of SEED_DEMO_PASSWORD' : `Password: ${DEFAULT_DEMO_PASSWORD}  (development only)`);
  } finally {
    await prisma.$disconnect();
  }
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { sampleTasks, sampleSessions, DEMO_EMAIL };
