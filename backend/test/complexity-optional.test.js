'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createInput, updateInput } = require('../src/modules/tasks/tasks.validator');

const BASE = { taskName: 'Write', importance: 'High', goalContribution: 'High', consequenceOfDelay: 'Major', estimatedDurationMinutes: 90 };

describe('Complexity is optional for task input (still stored: it feeds the ML energy-suitability factor)', () => {
  test('create without complexity defaults to the neutral "Moderate"', () => {
    assert.equal(createInput(BASE).complexity, 'Moderate');
  });
  test('an old client that still sends complexity keeps working and the value is kept', () => {
    assert.equal(createInput({ ...BASE, complexity: 'Complex' }).complexity, 'Complex');
    assert.throws(() => createInput({ ...BASE, complexity: 'Huge' }), (e) => e.status === 422);
  });
  test('update without complexity never overwrites the stored value of an existing record', () => {
    const existing = { ...BASE, complexity: 'Complex', description: null, startDate: null, dueDate: null, minimumSessionMinutes: null, isSplittable: false, preferredTime: 'Anytime', status: 'Pending' };
    const { patch, merged } = updateInput({ taskName: 'Renamed' }, existing);
    assert.deepEqual(patch, { taskName: 'Renamed' }); // complexity is not in the write set at all
    assert.equal(merged.complexity, 'Complex');
  });
  test('duration is validated in total minutes (hours+minutes UI converts before sending)', () => {
    assert.equal(createInput({ ...BASE, estimatedDurationMinutes: 195 }).estimatedDurationMinutes, 195);
    for (const bad of [0, -5, 10081, 1.5]) assert.throws(() => createInput({ ...BASE, estimatedDurationMinutes: bad }), (e) => e.status === 422);
  });
});
