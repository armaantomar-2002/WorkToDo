"""Stage 2 tests: eligibility, feasibility/time constraints, category assignment, input validation.
Run:  python -m unittest tests.test_stage2 -v      (from worktodo_service/)
Set WT_MODULE_DIR to test a different copy of worktodo_features.py (e.g. backup/user_v1)."""
import hashlib, os, sys, unittest, warnings
from pathlib import Path
import joblib, numpy as np, pandas as pd

warnings.filterwarnings('ignore')
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, os.environ.get('WT_MODULE_DIR', str(ROOT)))
import worktodo_features as wf

ValidationError = getattr(wf, 'InputValidationError', ValueError)
MODEL = joblib.load(ROOT / 'artifacts' / 'worktodo_recommendation_model.joblib')


class StubModel:
    """Returns preset scores in the order rows are passed (= eligible input order) to control ranking exactly."""
    def __init__(self, scores): self.scores = list(scores)
    def predict(self, X): return np.array(self.scores[:len(X)], dtype=float)


def task(tid='A', **kw):
    t = dict(task_id=tid, task_name=f'task {tid}', start_date='2026-11-01', due_date='2026-11-20', importance='High',
             goal_contribution='High', consequence_of_delay='Major', complexity='Simple', estimated_duration_minutes=30,
             minimum_session_minutes=30, is_splittable=False, preferred_time='Anytime', dependency_status='No dependency',
             status='Pending')
    t.update(kw); return t


def sess(**kw):
    s = dict(session_timestamp='2026-11-16 10:00:00', available_time_minutes=120, longest_free_slot_minutes=120,
             current_time_period='Morning', energy_level='Medium', focus_level='High')
    s.update(kw); return s


def rank(tasks, model=MODEL, **s):
    return wf.rank_tasks(pd.DataFrame(tasks), sess(**s), model)


def by_id(ranked): return ranked.set_index('task_id')


class TestEligibility(unittest.TestCase):
    def test_status_rules(self):
        cases = {'Pending': True, 'In Progress': True, 'Completed': False, 'Cancelled': False}
        tasks = [task(f'T{i}', status=s) for i, s in enumerate(cases)]
        r, e = rank(tasks)
        ids = dict(zip(cases, [f'T{i}' for i in range(len(cases))]))
        for s, ok in cases.items():
            with self.subTest(status=s):
                self.assertEqual(ids[s] in set(r.task_id), ok)
                self.assertEqual(ids[s] in set(e.task_id), not ok)
        self.assertEqual(set(e.exclusion_reason), {'Task not active'})

    def test_blocked_excluded(self):
        r, e = rank([task('A'), task('B', dependency_status='Blocked')])
        self.assertEqual(list(r.task_id), ['A']); self.assertEqual(e.exclusion_reason.tolist(), ['Blocked dependency'])

    def test_dependency_ready_and_none_eligible(self):
        r, _ = rank([task('A', dependency_status='Ready'), task('B', dependency_status='No dependency')])
        self.assertEqual(len(r), 2)

    def test_future_start_excluded_today_and_past_allowed(self):
        r, e = rank([task('F', start_date='2026-11-17'), task('T', start_date='2026-11-16'), task('P', start_date='2026-10-01')])
        self.assertEqual(set(r.task_id), {'T', 'P'}); self.assertEqual(e.task_id.tolist(), ['F'])
        self.assertEqual(e.exclusion_reason.tolist(), ['Start date in future'])

    def test_excluded_never_actionable(self):
        tasks = [task('OK1'), task('C', status='Completed'), task('X', status='Cancelled'), task('B', dependency_status='Blocked'),
                 task('F', start_date='2027-01-01'), task('OK2')]
        r, e = rank(tasks)
        self.assertTrue(set(r.task_id).isdisjoint(e.task_id)); self.assertEqual(set(e.task_id), {'C', 'X', 'B', 'F'})
        self.assertTrue(set(r.category) <= {'Do now', 'Do next', 'Schedule later'})

    def test_status_takes_precedence_over_blocked(self):
        _, e = rank([task('A', status='Completed', dependency_status='Blocked')])
        self.assertEqual(e.exclusion_reason.tolist(), ['Task not active'])

    def test_missing_start_and_dependency_mean_no_restriction(self):
        for kw in [dict(start_date=None), dict(dependency_status=None), dict(start_date=None, dependency_status=None)]:
            with self.subTest(kw=kw):
                r, e = rank([task('A', **kw)]); self.assertEqual(len(r), 1); self.assertEqual(len(e), 0)
        t = task('A'); del t['start_date']; del t['dependency_status']      # omitted entirely
        r, e = rank([t]); self.assertEqual(len(r), 1)

    def test_all_excluded_returns_empty_ranked(self):
        r, e = rank([task('A', status='Completed'), task('B', dependency_status='Blocked')])
        self.assertEqual(len(r), 0); self.assertEqual(len(e), 2)


def expected_startable(d, m, splittable, A, L):
    slot = min(A, L)
    return d <= slot if not splittable else min(m, d) <= slot


class TestFeasibilityAndTime(unittest.TestCase):
    def test_nonsplittable_must_fit_full_duration_even_if_minimum_is_smaller(self):
        r, _ = rank([task('A', estimated_duration_minutes=60, minimum_session_minutes=10, is_splittable=False)],
                    available_time_minutes=120, longest_free_slot_minutes=20)
        row = r.iloc[0]
        self.assertFalse(bool(row.startable_now)); self.assertEqual(row.category, 'Schedule later'); self.assertLessEqual(row.feasibility, 40)

    def test_nonsplittable_starts_when_full_duration_fits(self):
        r, _ = rank([task('A', estimated_duration_minutes=60, minimum_session_minutes=10)], longest_free_slot_minutes=60)
        self.assertTrue(bool(r.iloc[0].startable_now)); self.assertEqual(r.iloc[0].feasibility, 100)

    def test_total_free_time_is_not_longest_slot(self):
        r, _ = rank([task('N45', estimated_duration_minutes=45, minimum_session_minutes=45)], available_time_minutes=120, longest_free_slot_minutes=20)
        self.assertFalse(bool(r.iloc[0].startable_now))

    def test_splittable_partial_progress(self):
        r, _ = rank([task('S', estimated_duration_minutes=120, minimum_session_minutes=15, is_splittable=True)],
                    available_time_minutes=45, longest_free_slot_minutes=20)
        row = r.iloc[0]; self.assertTrue(bool(row.startable_now)); self.assertTrue(60 <= row.feasibility < 100)

    def test_splittable_minimum_larger_than_slot_not_startable(self):
        r, _ = rank([task('S', estimated_duration_minutes=120, minimum_session_minutes=30, is_splittable=True)],
                    available_time_minutes=45, longest_free_slot_minutes=20)
        self.assertFalse(bool(r.iloc[0].startable_now)); self.assertLessEqual(r.iloc[0].feasibility, 40)

    def test_slot_cannot_exceed_available_time(self):
        r, _ = rank([task('A', estimated_duration_minutes=30, minimum_session_minutes=30)], available_time_minutes=20, longest_free_slot_minutes=60)
        self.assertFalse(bool(r.iloc[0].startable_now))

    def test_zero_available_time_allowed_nothing_startable(self):
        tasks = [task('N', estimated_duration_minutes=5, minimum_session_minutes=5),
                 task('S', estimated_duration_minutes=60, minimum_session_minutes=5, is_splittable=True)]
        for kw in [dict(available_time_minutes=0, longest_free_slot_minutes=0), dict(available_time_minutes=0, longest_free_slot_minutes=30)]:
            with self.subTest(kw=kw):
                r, _ = rank(tasks, **kw)
                self.assertEqual(len(r), 2); self.assertFalse(r.startable_now.any()); self.assertTrue((r.category == 'Schedule later').all())

    def test_grid_availability_and_slots(self):
        tasks = [task('N15', estimated_duration_minutes=15, minimum_session_minutes=15), task('N30', estimated_duration_minutes=30, minimum_session_minutes=5),
                 task('N60', estimated_duration_minutes=60, minimum_session_minutes=60), task('S120', estimated_duration_minutes=120, minimum_session_minutes=15, is_splittable=True),
                 task('S40', estimated_duration_minutes=40, minimum_session_minutes=40, is_splittable=True),
                 task('S20m20', estimated_duration_minutes=20, minimum_session_minutes=20, is_splittable=True)]
        meta = {t['task_id']: t for t in tasks}
        for A in (10, 20, 45, 120):
            for L in sorted({0, 5, A // 2, A, A + 30}):
                r, _ = rank(tasks, available_time_minutes=A, longest_free_slot_minutes=L)
                for _, row in r.iterrows():
                    t = meta[row.task_id]
                    exp = expected_startable(t['estimated_duration_minutes'], t['minimum_session_minutes'], t['is_splittable'], A, L)
                    with self.subTest(A=A, L=L, task=row.task_id):
                        self.assertEqual(bool(row.startable_now), exp)
                        self.assertTrue(0 <= row.feasibility <= 100)
                        self.assertEqual(row.feasibility >= 60, exp)                  # startable <=> feasibility band 60-100
                        if not t['is_splittable'] and t['estimated_duration_minutes'] > min(A, L):
                            self.assertFalse(bool(row.startable_now))
                        if not exp: self.assertNotIn(row.category, ('Do now', 'Do next'))

    def test_all_seven_factors_in_range(self):
        r, _ = rank([task('A'), task('B', due_date=None, importance='Low', goal_contribution='No linked goal', consequence_of_delay='No consequence'),
                     task('C', due_date='2026-11-01')], available_time_minutes=0, longest_free_slot_minutes=0)
        self.assertTrue(((r[wf.FEATURES] >= 0) & (r[wf.FEATURES] <= 100)).all().all())
        self.assertTrue(((r.ml_score >= 0) & (r.ml_score <= 100)).all())


class TestCategories(unittest.TestCase):
    def _run(self, startable_flags, scores=None):
        n = len(startable_flags); scores = scores or [90 - 10 * i for i in range(n)]
        tasks = [task(f'T{i + 1}', estimated_duration_minutes=30 if ok else 90, minimum_session_minutes=30 if ok else 90) for i, ok in enumerate(startable_flags)]
        r, _ = rank(tasks, StubModel(scores), available_time_minutes=60, longest_free_slot_minutes=60)
        return r.set_index('task_id')

    def test_score_ordering_descending(self):
        r = self._run([True] * 4, [10, 40, 30, 20])
        self.assertEqual(list(r.index), ['T2', 'T3', 'T4', 'T1']); self.assertEqual(list(r['rank']), [1, 2, 3, 4])

    def test_no_startable_tasks(self):
        r = self._run([False, False, False]); self.assertTrue((r.category == 'Schedule later').all())

    def test_one_startable_task_is_do_now_even_if_ranked_last(self):
        r = self._run([False, False, True])
        self.assertEqual(r.loc['T3', 'category'], 'Do now'); self.assertEqual(r.loc['T3', 'rank'], 3)
        self.assertEqual(r.loc[['T1', 'T2'], 'category'].tolist(), ['Schedule later'] * 2)

    def test_two_startable(self):
        r = self._run([True, False, True]); self.assertEqual(r.category.tolist(), ['Do now', 'Schedule later', 'Do next'])

    def test_more_than_three_startable(self):
        r = self._run([True] * 6)
        self.assertEqual(r.category.tolist(), ['Do now', 'Do next', 'Do next', 'Schedule later', 'Schedule later', 'Schedule later'])

    def test_unstartable_high_scorer_stays_schedule_later(self):
        r = self._run([False, True, True, True, True])
        self.assertEqual(r.category.tolist(), ['Schedule later', 'Do now', 'Do next', 'Do next', 'Schedule later'])

    def test_custom_counts(self):
        tasks = [task(f'T{i}') for i in range(5)]
        r, _ = wf.rank_tasks(pd.DataFrame(tasks), sess(), StubModel([5, 4, 3, 2, 1]), n_now=2, n_next=1)
        self.assertEqual(r.category.tolist(), ['Do now', 'Do now', 'Do next', 'Schedule later', 'Schedule later'])

    def test_do_now_count_never_exceeds_one_by_default(self):
        r, _ = rank([task(f'T{i}') for i in range(8)])
        self.assertEqual((r.category == 'Do now').sum(), 1); self.assertEqual((r.category == 'Do next').sum(), 2)

    def test_equal_score_ties_use_urgency_then_task_id(self):
        # all three round to 50.000000 -> urgency decides (due-date based), then task_id
        tasks = [task('Z', due_date='2026-11-30'), task('B', due_date='2026-11-16'), task('A', due_date='2026-11-16'), task('C', due_date='2026-11-16')]
        r, _ = rank(tasks, StubModel([50.0000001, 50.0000004, 50.0000002, 50.0000003]))
        self.assertEqual(list(r.task_id), ['A', 'B', 'C', 'Z'])
        self.assertEqual(set(r.ml_score.round(7)), {50.0000001, 50.0000004, 50.0000002, 50.0000003})   # unrounded scores preserved

    def test_ties_deterministic_for_identical_tasks_any_input_order(self):
        for order in (['T0', 'T1', 'T2'], ['T2', 'T0', 'T1'], ['T1', 'T2', 'T0']):
            r, _ = rank([task(i) for i in order]); self.assertEqual(list(r.task_id), ['T0', 'T1', 'T2'])

    def test_higher_rounded_score_beats_urgency(self):
        r, _ = rank([task('A', due_date='2026-11-16'), task('B', due_date='2026-12-30')], StubModel([40.0, 40.01]))
        self.assertEqual(list(r.task_id), ['B', 'A'])


class TestValidation(unittest.TestCase):
    def bad(self, tasks, text, **s):
        with self.assertRaises(ValidationError) as cm: rank(tasks, **s)
        self.assertIn(text, str(cm.exception)); return cm.exception

    def test_empty_task_lists(self):
        for empty in ([], pd.DataFrame()):
            r, e = wf.rank_tasks(empty, sess(), MODEL); self.assertEqual((len(r), len(e)), (0, 0))
        r, e = wf.rank_tasks(pd.DataFrame(columns=list(task())), sess(), MODEL); self.assertEqual((len(r), len(e)), (0, 0))

    def test_duplicate_ids(self): self.bad([task('D'), task('D', importance='Low')], 'duplicate task_id')
    def test_missing_or_blank_id(self): self.bad([task(None)], 'task_id is missing'); self.bad([task('  ')], 'task_id is missing')
    def test_missing_status(self): self.bad([task('A', status=None)], 'status is missing')
    def test_missing_is_splittable(self): self.bad([task('A', is_splittable=None)], 'is_splittable is missing'); self.bad([task('A', is_splittable=np.nan)], 'is_splittable is missing')
    def test_invalid_is_splittable(self): self.bad([task('A', is_splittable='false')], 'is_splittable must be true or false')
    def test_missing_required_column(self):
        t = task('A'); del t['is_splittable']; self.bad([t], 'missing required task field(s): is_splittable')
    def test_invalid_due_date(self): self.bad([task('A', due_date='not-a-date')], 'due_date')
    def test_invalid_start_date(self): self.bad([task('A', start_date='2026-13-45')], 'start_date')
    def test_blank_date_string_invalid(self): self.bad([task('A', due_date='')], 'due_date')
    def test_missing_due_date_means_no_deadline(self):
        r, _ = rank([task('A', due_date=None)]); self.assertEqual(r.iloc[0].urgency, 10)
    def test_timezone_dates_rejected(self):
        self.bad([task('A', due_date='2026-11-20T10:00:00Z')], 'timezone'); self.bad([task('A')], 'session_timestamp', session_timestamp='2026-11-16T10:00:00Z')
    def test_negative_duration(self): self.bad([task('A', estimated_duration_minutes=-30)], 'negative')
    def test_zero_duration(self): self.bad([task('A', estimated_duration_minutes=0)], 'zero')
    def test_non_numeric_duration(self): self.bad([task('A', estimated_duration_minutes='abc')], 'estimated_duration_minutes'); self.bad([task('A', estimated_duration_minutes=None)], 'estimated_duration_minutes is missing')
    def test_splittable_needs_valid_minimum(self):
        self.bad([task('A', is_splittable=True, minimum_session_minutes=None)], 'minimum_session_minutes'); self.bad([task('A', is_splittable=True, minimum_session_minutes=0)], 'minimum_session_minutes')
    def test_splittable_minimum_exceeding_duration_rejected_not_clamped(self):
        e = self.bad([task('A', is_splittable=True, estimated_duration_minutes=20, minimum_session_minutes=30)], 'must not exceed estimated_duration_minutes')
        self.assertIn('task_id: A', str(e))
        rank([task('A', is_splittable=True, estimated_duration_minutes=20, minimum_session_minutes=20)])   # equal is valid
    def test_nonsplittable_ignores_missing_minimum(self):
        r, _ = rank([task('A', minimum_session_minutes=None)]); self.assertEqual(len(r), 1)
    def test_negative_available_time(self): self.bad([task('A')], 'available_time_minutes', available_time_minutes=-5)
    def test_negative_longest_slot(self): self.bad([task('A')], 'longest_free_slot_minutes', longest_free_slot_minutes=-1)
    def test_invalid_current_period(self):
        for p in ('Noon', 'morning', None): self.bad([task('A')], 'current_time_period', current_time_period=p)
    def test_session_missing_field(self):
        s = sess(); del s['energy_level']
        with self.assertRaises(ValidationError) as cm: wf.rank_tasks(pd.DataFrame([task('A')]), s, MODEL)
        self.assertIn('energy_level', str(cm.exception))
    def test_unknown_dependency_value_rejected(self): self.bad([task('A', dependency_status='blocked')], 'dependency_status')
    def test_all_problems_reported_together(self):
        e = self.bad([task('A', status=None, estimated_duration_minutes=-1), task('B', due_date='xx')], 'status is missing')
        self.assertIn('negative', str(e)); self.assertIn('due_date', str(e))
    def test_session_and_task_errors_reported_together(self):
        e = self.bad([task('A', status=None)], 'status is missing', current_time_period='Noon')
        self.assertIn('current_time_period', str(e))
    def test_zero_available_time_is_valid(self): rank([task('A')], available_time_minutes=0, longest_free_slot_minutes=0)
    def test_input_not_mutated(self):
        df = pd.DataFrame([task('A'), task('B', status='Completed')]); before = df.copy(deep=True)
        wf.rank_tasks(df, sess(), MODEL); pd.testing.assert_frame_equal(df, before)


class TestArtifactsAndContract(unittest.TestCase):
    def test_model_is_linear_regression_and_feature_order(self):
        self.assertEqual(type(MODEL.named_steps['model']).__name__, 'LinearRegression')
        self.assertEqual(MODEL.named_steps['prep'].transformers_[0][2], wf.FEATURES)

    def test_weights_and_features_unchanged(self):
        self.assertEqual(wf.WEIGHTS, {'urgency': .30, 'importance': .20, 'goal_contribution': .15, 'feasibility': .15,
                                      'consequence_of_delay': .10, 'timing_suitability': .05, 'energy_suitability': .05})
        self.assertAlmostEqual(sum(wf.WEIGHTS.values()), 1.0)

    def test_artifact_checksums_unchanged(self):
        for line in (ROOT / 'backup' / 'CHECKSUMS_before_stage2.sha256').read_text().splitlines():
            digest, name = line.split(maxsplit=1)
            if name.startswith('artifacts/'):
                self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), digest, name)

    def test_model_matches_formula_on_real_inputs(self):
        r, _ = rank([task('A'), task('B', importance='Low', due_date=None)])
        np.testing.assert_allclose(r.ml_score, wf.weighted_score(r[wf.FEATURES]), atol=1e-6)

    def test_consequence_wording_preserved(self):
        r, _ = rank([task('A', consequence_of_delay='No consequence', importance='Low', goal_contribution='No linked goal', due_date=None)])
        self.assertIn('No consequence if delayed', r.iloc[0].reason)


if __name__ == '__main__':
    unittest.main(verbosity=2)
