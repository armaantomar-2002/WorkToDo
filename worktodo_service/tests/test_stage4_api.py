"""Stage 4 API tests using fastapi.testclient (in-process ASGI, no network). SKIPPED when fastapi/httpx are not installed."""
import json, os, shutil, sys, tempfile, unittest, warnings
from pathlib import Path
from unittest import mock
warnings.filterwarnings('ignore')
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import fastapi, httpx                                   # noqa: F401
    from fastapi.testclient import TestClient
    HAS_API = True
except ImportError:
    HAS_API = False
from stage4_common import *
from app import config, service
from app.errors import ArtifactError
if HAS_API:
    from app.main import create_app

REQUIRED = {'rank', 'task_id', 'task_name', 'ml_score', 'category', 'startable_now', 'reason'} | set(wf.FEATURES)


def broken_dir(testcase, corrupt=None, skip=None):
    d = Path(tempfile.mkdtemp()); testcase.addCleanup(shutil.rmtree, d, True)
    for f in (config.MODEL_FILE, config.PREPROCESSOR_FILE, config.CONFIG_FILE):
        if f != skip: shutil.copy(ART_DIR / f, d / f)
    if corrupt: (d / corrupt).write_bytes(b'corrupt')
    return d


@unittest.skipUnless(HAS_API, 'fastapi/httpx not installed - API tests not executed')
class TestApiWithRealArtifacts(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cm = TestClient(create_app(ART_DIR), raise_server_exceptions=False); cls.c = cls.cm.__enter__()

    @classmethod
    def tearDownClass(cls): cls.cm.__exit__(None, None, None)

    def post(self, tasks, session=None, **extra): return self.c.post('/recommend', json={'session': session or sess(), 'tasks': tasks, **extra})

    def assert_error(self, r, status, kind):
        self.assertEqual(r.status_code, status); b = r.json(); self.assertEqual(b['error'], kind); self.assertIn('message', b)
        self.assertNotIn('Traceback', r.text); return b

    # --- health / model-info
    def test_health_ok(self):
        r = self.c.get('/health'); self.assertEqual(r.status_code, 200); b = r.json()
        self.assertEqual((b['status'], b['api_running'], b['model_loaded'], b['preprocessor_loaded'], b['config_loaded'], b['ready'], b['error']), ('ok', True, True, True, True, True, None))

    def test_model_info(self):
        r = self.c.get('/model-info'); self.assertEqual(r.status_code, 200); b = r.json()
        self.assertEqual((b['model_name'], b['model_type']), ('Linear Regression', 'LinearRegression')); self.assertEqual(b['weights'], wf.WEIGHTS)
        self.assertEqual([f['name'] for f in b['factors']], wf.FEATURES)
        for leak in (str(ROOT), '/mnt', '.joblib'): self.assertNotIn(leak, r.text)

    # --- valid requests
    def test_valid_request_schema_and_status(self):
        r = self.c.post('/recommend', json=SAMPLE); self.assertEqual(r.status_code, 200); b = r.json()
        self.assertEqual(set(b), {'ranked', 'excluded', 'summary'}); self.assertTrue(all(REQUIRED <= set(x) for x in b['ranked']))
        self.assertEqual([x['task_id'] for x in b['excluded']], ['T3']); self.assertEqual(b['summary']['total_tasks'], 3)
        self.assertIn(b['ranked'][0]['category'], ('Do now',)); self.assertTrue(all(isinstance(x['reason'], str) and x['reason'] for x in b['ranked']))

    def test_multiple_tasks_ranked_descending(self):
        b = self.post([task(f'T{i}', importance=['Low', 'Medium', 'High', 'Critical'][i % 4]) for i in range(8)]).json()
        self.assertEqual([x['rank'] for x in b['ranked']], list(range(1, 9))); sc = [round(x['ml_score'], 6) for x in b['ranked']]; self.assertEqual(sc, sorted(sc, reverse=True))

    def test_top_k(self):
        self.assertEqual(len(self.post([task(f'T{i}') for i in range(6)], top_k=2).json()['ranked']), 2)
        self.assert_error(self.post([task('A')], top_k=0), 422, 'validation_error')

    def test_empty_task_list(self):
        r = self.post([]); self.assertEqual(r.status_code, 200); self.assertEqual(r.json()['ranked'], []); self.assertEqual(r.json()['summary']['total_tasks'], 0)

    def test_all_excluded(self):
        b = self.post([task('A', status='Completed'), task('B', dependency_status='Blocked')]).json()
        self.assertEqual(b['ranked'], []); self.assertEqual(len(b['excluded']), 2)

    def test_zero_available_time_allowed_nothing_startable(self):
        r = self.post([task('A'), task('B')], sess(available_time_minutes=0, longest_free_slot_minutes=0)); self.assertEqual(r.status_code, 200)
        self.assertTrue(all(not x['startable_now'] and x['category'] == 'Schedule later' for x in r.json()['ranked']))

    # --- validation (422) with engine messages
    def test_engine_validation_errors_are_422_with_structured_body(self):
        cases = [('invalid categorical', [task('A', importance='Urgent')], None, 'importance has invalid value'), ('duplicate ids', [task('A'), task('A')], None, 'duplicate task_id'),
                 ('invalid date', [task('A', due_date='not-a-date')], None, 'due_date'), ('negative duration', [task('A', estimated_duration_minutes=-1)], None, 'negative'),
                 ('zero duration', [task('A', estimated_duration_minutes=0)], None, 'zero'),
                 ('splittable min > duration', [task('A', is_splittable=True, estimated_duration_minutes=20, minimum_session_minutes=30)], None, 'must not exceed'),
                 ('negative available time', [task('A')], sess(available_time_minutes=-5), 'available_time_minutes'),
                 ('invalid period', [task('A')], sess(current_time_period='Noon'), 'current_time_period'), ('null status', [task('A', status=None)], None, 'status is missing'),
                 ('null is_splittable', [task('A', is_splittable=None)], None, 'is_splittable is missing')]
        for name, tasks, session, text in cases:
            with self.subTest(case=name):
                b = self.assert_error(self.post(tasks, session), 422, 'validation_error'); self.assertIn(text, json.dumps(b['errors'])); self.assertTrue(all({'field', 'message'} <= set(e) for e in b['errors']))

    def test_missing_required_fields(self):
        b = self.assert_error(self.c.post('/recommend', json={'tasks': [task('A')]}), 422, 'validation_error'); self.assertIn('session', [e['field'] for e in b['errors']])
        b = self.assert_error(self.c.post('/recommend', json={'session': sess()}), 422, 'validation_error'); self.assertIn('tasks', [e['field'] for e in b['errors']])
        t = task('A'); del t['is_splittable']; b = self.assert_error(self.post([t]), 422, 'validation_error'); self.assertIn('is_splittable', json.dumps(b['errors']))
        s = sess(); del s['energy_level']; b = self.assert_error(self.post([task('A')], s), 422, 'validation_error'); self.assertIn('energy_level', json.dumps(b['errors']))

    def test_optional_nulls_follow_engine_rules(self):
        self.assertEqual(self.post([task('A', start_date=None, dependency_status=None, due_date=None)]).status_code, 200)

    def test_structure_errors(self):
        self.assert_error(self.c.post('/recommend', json={'session': sess(), 'tasks': 'nope'}), 422, 'validation_error')
        self.assert_error(self.c.post('/recommend', json=[1, 2]), 422, 'validation_error')
        self.assert_error(self.c.post('/recommend', json={'session': 'x', 'tasks': []}), 422, 'validation_error')

    def test_malformed_json_is_400(self):
        self.assert_error(self.c.post('/recommend', content='{"session": ', headers={'Content-Type': 'application/json'}), 400, 'malformed_json')

    def test_unknown_route_and_method(self):
        self.assert_error(self.c.get('/nope'), 404, 'http_error'); self.assert_error(self.c.get('/recommend'), 405, 'http_error')

    def test_unexpected_internal_error_is_safe_500(self):
        with mock.patch.object(service, 'recommend', side_effect=RuntimeError('SECRET /etc/passwd stack detail')):
            r = self.post([task('A')])
        b = self.assert_error(r, 500, 'internal_error'); self.assertIn('error_id', b)
        for leak in ('SECRET', '/etc/passwd', 'RuntimeError', 'File "'): self.assertNotIn(leak, r.text)

    # --- engine vs API consistency (mandatory)
    def test_engine_vs_api_consistency_all_scenarios(self):
        for name, (session, tasks) in scenarios().items():
            with self.subTest(scenario=name):
                r = self.c.post('/recommend', json={'session': session, 'tasks': tasks}); self.assertEqual(r.status_code, 200); engine_compare(self, name, session, tasks, r.json())

    def test_engine_vs_api_consistency_top_k(self):
        session, tasks = scenarios()['many']
        r = self.c.post('/recommend', json={'session': session, 'tasks': tasks, 'top_k': 4}); engine_compare(self, 'many', session, tasks, r.json(), top_k=4)


@unittest.skipUnless(HAS_API, 'fastapi/httpx not installed - API tests not executed')
class TestApiNotReady(unittest.TestCase):
    def client(self, directory, **kw):
        cm = TestClient(create_app(directory), raise_server_exceptions=False); c = cm.__enter__(); self.addCleanup(cm.__exit__, None, None, None); return c

    def assert_not_ready(self, c, code, loaded):
        r = c.get('/health'); self.assertEqual(r.status_code, 503); b = r.json()
        self.assertEqual((b['ready'], b['api_running'], b['status'], b['error']['code']), (False, True, 'unavailable', code))
        self.assertEqual((b['model_loaded'], b['preprocessor_loaded'], b['config_loaded']), loaded)
        self.assertNotIn(str(ROOT), r.text); self.assertNotIn('Traceback', r.text)
        for method, path in (('post', '/recommend'), ('get', '/model-info')):
            r = getattr(c, method)(path, **({'json': SAMPLE} if method == 'post' else {})); self.assertEqual(r.status_code, 503); self.assertEqual(r.json()['error'], 'service_unavailable')

    def test_missing_artifacts(self): self.assert_not_ready(self.client(Path(tempfile.gettempdir()) / 'wt_missing_dir'), 'artifact_missing', (False, False, False))
    def test_missing_preprocessor_only(self): self.assert_not_ready(self.client(broken_dir(self, skip=config.PREPROCESSOR_FILE)), 'artifact_missing', (True, False, False))
    def test_model_loading_failure(self): self.assert_not_ready(self.client(broken_dir(self, corrupt=config.MODEL_FILE)), 'model_load_failed', (False, False, False))

    def test_unexpected_loader_exception_reported_as_not_ready(self):
        def boom(_): raise RuntimeError('secret detail')
        cm = TestClient(create_app(ART_DIR, loader=boom), raise_server_exceptions=False); c = cm.__enter__(); self.addCleanup(cm.__exit__, None, None, None)
        r = c.get('/health'); self.assertEqual(r.status_code, 503); self.assertNotIn('secret', r.text)

    def test_strict_startup_refuses_to_start(self):
        with mock.patch.dict(os.environ, {'WORKTODO_STRICT_STARTUP': '1'}):
            with self.assertRaises(Exception):
                with TestClient(create_app(Path(tempfile.gettempdir()) / 'wt_missing_dir')): pass


if __name__ == '__main__':
    unittest.main(verbosity=2)
