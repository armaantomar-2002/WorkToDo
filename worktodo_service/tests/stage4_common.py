"""Shared helpers for Stage 4 tests: scenarios + engine-vs-service/API comparison (no FastAPI needed)."""
import json, math, sys
from pathlib import Path
import numpy as np, pandas as pd
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / 'tests'))
import worktodo_features as wf
from test_stage2 import task, sess
from app.artifacts import load_artifacts
from app.service import RANKED_FIELDS

ART_DIR = ROOT / 'artifacts'
ARTS = load_artifacts(ART_DIR)
MODEL = ARTS.model
FIXTURES = json.loads((ROOT / 'tests' / 'fixtures' / 'tie_category_sessions.json').read_text())
SAMPLE = json.loads((ROOT / 'tests' / 'fixtures' / 'sample_request.json').read_text())


def scenarios():
    rng = np.random.RandomState(11); many = []
    for i in range(60):
        spl = bool(rng.rand() < .5); d = int(rng.choice([10, 20, 45, 60, 120]))
        many.append(task(f'M{i:02d}', status=str(rng.choice(['Pending', 'In Progress', 'Pending', 'Completed'])), due_date=rng.choice([None, '2026-11-14', '2026-11-16', '2026-11-18', '2026-12-20']),
                         importance=str(rng.choice(list(wf.IMPORTANCE_MAP))), goal_contribution=str(rng.choice(list(wf.GOAL_MAP))), consequence_of_delay=str(rng.choice(list(wf.CONSEQUENCE_MAP))),
                         complexity=str(rng.choice(['Simple', 'Moderate', 'Complex'])), preferred_time=str(rng.choice(['Morning', 'Evening', 'Anytime'])), estimated_duration_minutes=d,
                         minimum_session_minutes=min(d, 15) if spl else d, is_splittable=spl, dependency_status=str(rng.choice(['No dependency', 'Ready', 'Blocked']))))
    out = {f"fixture_{f['session_id']}": (f['session'], f['tasks']) for f in FIXTURES}
    out.update({
        'mixed_statuses': (sess(available_time_minutes=45, longest_free_slot_minutes=30), [
            task('A'), task('B', status='In Progress'), task('C', status='Completed'), task('D', status='Cancelled'), task('E', dependency_status='Blocked'),
            task('F', start_date='2026-12-01'), task('G', estimated_duration_minutes=120, minimum_session_minutes=15, is_splittable=True),
            task('H', estimated_duration_minutes=90, minimum_session_minutes=90)]),
        'six_startable': (sess(), [task(f'S{i}', importance=['Low', 'Medium', 'High', 'Critical'][i % 4], due_date=f'2026-11-{17 + i}') for i in range(6)]),
        'zero_time': (sess(available_time_minutes=0, longest_free_slot_minutes=0), [task('A'), task('B', due_date=None)]),
        'ties': (sess(), [task('T3'), task('T1'), task('T2')]),
        'int_ids_null_name': (sess(), [task(2, task_name=None), task(1, task_name=None, importance='Low')]),
        'many': (sess(available_time_minutes=60, longest_free_slot_minutes=45, current_time_period='Evening', energy_level='Low', focus_level='High'), many),
        'empty': (sess(), []),
        'all_excluded': (sess(), [task('A', status='Completed'), task('B', dependency_status='Blocked')]),
    })
    return out


def _norm(v):
    if isinstance(v, np.generic): v = v.item()
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else v


def engine_compare(tc, name, session, tasks, resp, top_k=None):
    """Run the standalone engine on identical inputs and assert the service/API response matches it exactly.
    Only permitted differences: numpy->Python types, NaN->null, and the added 'summary' block / field subset."""
    ranked, excluded = wf.rank_tasks(pd.DataFrame(tasks), session, MODEL)
    exp = [{k: _norm(v) for k, v in r.items()} for r in ranked[RANKED_FIELDS].to_dict('records')]
    if top_k: exp = exp[:top_k]
    tc.assertEqual(len(resp['ranked']), len(exp), name)
    for e, a in zip(exp, resp['ranked']):
        tc.assertEqual(list(a)[:len(RANKED_FIELDS)], RANKED_FIELDS, name)
        for k in RANKED_FIELDS: tc.assertEqual(e[k], a[k], f'{name}: {k} of task {e["task_id"]}')
    tc.assertEqual([(_norm(t), r) for t, r in zip(excluded.task_id, excluded.exclusion_reason)], [(x['task_id'], x['exclusion_reason']) for x in resp['excluded']], name)
    s = resp['summary']
    tc.assertEqual((s['total_tasks'], s['eligible'], s['excluded'], s['returned'], s['startable_now']),
                   (len(tasks), len(ranked), len(excluded), len(exp), int(ranked.startable_now.astype(bool).sum()) if len(ranked) else 0), name)
