"""Stage 4 HTTP integration tests: starts a REAL uvicorn process and sends real HTTP requests (stdlib urllib).
SKIPPED when fastapi/uvicorn are not installed."""
import importlib.util, json, os, shutil, socket, subprocess, sys, tempfile, time, unittest, urllib.error, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
HAS_SERVER = all(importlib.util.find_spec(m) for m in ('fastapi', 'uvicorn', 'pydantic', 'starlette'))
from stage4_common import *
from app import config


def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p


def call(base, method, path, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')


class Server:
    def __init__(self, env=None):
        self.port = free_port(); self.base = f'http://127.0.0.1:{self.port}'; self.log = tempfile.TemporaryFile(); self.env = {**os.environ, **(env or {})}

    def start(self, timeout=60):
        self.p = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', str(self.port)], cwd=ROOT, env=self.env, stdout=self.log, stderr=subprocess.STDOUT)
        end = time.time() + timeout
        while time.time() < end:
            if self.p.poll() is not None: break
            try: call(self.base, 'GET', '/health'); return True
            except OSError: time.sleep(0.3)
        return False

    def stop(self):
        if self.p.poll() is None: self.p.terminate(); self.p.wait(timeout=15)

    def output(self): self.log.seek(0); return self.log.read().decode(errors='replace')[-2000:]


@unittest.skipUnless(HAS_SERVER, 'fastapi/uvicorn not installed - HTTP integration tests not executed')
class TestHttpIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = Server(); ok = cls.srv.start()
        if not ok: raise RuntimeError('server failed to start:\n' + cls.srv.output())
        cls.b = cls.srv.base

    @classmethod
    def tearDownClass(cls): cls.srv.stop()

    def test_health(self):
        s, b = call(self.b, 'GET', '/health'); self.assertEqual(s, 200); self.assertTrue(b['ready'] and b['model_loaded'] and b['preprocessor_loaded'])

    def test_model_info(self):
        s, b = call(self.b, 'GET', '/model-info'); self.assertEqual((s, b['model_name'], b['weights']), (200, 'Linear Regression', wf.WEIGHTS))

    def test_recommend_sample(self):
        s, b = call(self.b, 'POST', '/recommend', SAMPLE); self.assertEqual(s, 200); self.assertEqual(b['ranked'][0]['category'], 'Do now'); self.assertEqual(b['excluded'][0]['task_id'], 'T3')

    def test_engine_vs_http_consistency_all_scenarios(self):
        for name, (session, tasks) in scenarios().items():
            with self.subTest(scenario=name):
                s, b = call(self.b, 'POST', '/recommend', {'session': session, 'tasks': tasks}); self.assertEqual(s, 200); engine_compare(self, name, session, tasks, b)

    def test_empty_and_all_excluded(self):
        self.assertEqual(call(self.b, 'POST', '/recommend', {'session': sess(), 'tasks': []})[1]['ranked'], [])
        s, b = call(self.b, 'POST', '/recommend', {'session': sess(), 'tasks': [task('A', status='Completed')]}); self.assertEqual((s, b['ranked'], len(b['excluded'])), (200, [], 1))

    def test_validation_errors(self):
        for name, payload, text in [('categorical', {'session': sess(), 'tasks': [task('A', importance='Urgent')]}, 'importance'), ('duplicate', {'session': sess(), 'tasks': [task('A'), task('A')]}, 'duplicate'),
                                    ('date', {'session': sess(), 'tasks': [task('A', due_date='zzz')]}, 'due_date'), ('duration', {'session': sess(), 'tasks': [task('A', estimated_duration_minutes=-3)]}, 'negative'),
                                    ('min>dur', {'session': sess(), 'tasks': [task('A', is_splittable=True, estimated_duration_minutes=10, minimum_session_minutes=20)]}, 'must not exceed'),
                                    ('no session', {'tasks': [task('A')]}, 'session')]:
            with self.subTest(case=name):
                s, b = call(self.b, 'POST', '/recommend', payload); self.assertEqual((s, b['error']), (422, 'validation_error')); self.assertIn(text, json.dumps(b['errors']))

    def test_zero_available_time(self):
        s, b = call(self.b, 'POST', '/recommend', {'session': sess(available_time_minutes=0, longest_free_slot_minutes=0), 'tasks': [task('A')]}); self.assertEqual(s, 200); self.assertEqual(b['summary']['startable_now'], 0)

    def test_malformed_json_404_405(self):
        self.assertEqual(call(self.b, 'POST', '/recommend', raw=b'{"session":')[0], 400); self.assertEqual(call(self.b, 'GET', '/nope')[0], 404); self.assertEqual(call(self.b, 'GET', '/recommend')[0], 405)


@unittest.skipUnless(HAS_SERVER, 'fastapi/uvicorn not installed - HTTP integration tests not executed')
class TestHttpStartupFailures(unittest.TestCase):
    def test_missing_artifacts_service_up_but_not_ready(self):
        d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, d, True); srv = Server({'WORKTODO_ARTIFACT_DIR': d}); self.addCleanup(srv.stop)
        self.assertTrue(srv.start(), srv.output()); s, b = call(srv.base, 'GET', '/health'); self.assertEqual((s, b['ready'], b['error']['code']), (503, False, 'artifact_missing'))
        self.assertEqual(call(srv.base, 'POST', '/recommend', SAMPLE)[0], 503); self.assertEqual(call(srv.base, 'GET', '/model-info')[0], 503)

    def test_strict_startup_exits_nonzero(self):
        d = tempfile.mkdtemp(); self.addCleanup(shutil.rmtree, d, True); srv = Server({'WORKTODO_ARTIFACT_DIR': d, 'WORKTODO_STRICT_STARTUP': '1'})
        self.assertFalse(srv.start(timeout=30)); self.addCleanup(srv.stop); srv.p.wait(timeout=15); self.assertNotEqual(srv.p.returncode, 0)


if __name__ == '__main__':
    unittest.main(verbosity=2)
