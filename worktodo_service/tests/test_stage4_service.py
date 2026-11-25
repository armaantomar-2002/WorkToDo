"""Stage 4 UNIT tests (no FastAPI needed): artifact loading/verification, service layer, error bodies, engine-vs-service consistency."""
import copy, hashlib, json, os, re, shutil, sys, tempfile, unittest, warnings
from pathlib import Path
from unittest import mock
import joblib, numpy as np, pandas as pd
warnings.filterwarnings("ignore")
import logging; logging.disable(logging.CRITICAL)   # loader logs tracebacks for the deliberately corrupted files
sys.path.insert(0, str(Path(__file__).resolve().parent))
from stage4_common import *
from app import config, service
from app.artifacts import load_artifacts
from app.errors import ArtifactError, input_validation_body, request_validation_body
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import Ridge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

A = {'model': config.MODEL_FILE, 'preprocessor': config.PREPROCESSOR_FILE, 'config': config.CONFIG_FILE}


def tmp_artifacts(testcase, skip=()):
    d = Path(tempfile.mkdtemp()); testcase.addCleanup(shutil.rmtree, d, True)
    for f in A.values():
        if f not in skip: shutil.copy(ART_DIR / f, d / f)
    return d


class TestArtifactLoader(unittest.TestCase):
    def fail(self, d, code, **loaded):
        with self.assertRaises(ArtifactError) as cm: load_artifacts(d)
        self.assertEqual(cm.exception.code, code)
        self.assertNotIn(str(d), cm.exception.message); self.assertNotIn('Traceback', cm.exception.message)
        for k, v in loaded.items(): self.assertEqual(cm.exception.loaded[k], v, k)
        return cm.exception

    def test_real_artifacts_load_and_verify(self):
        a = load_artifacts(ART_DIR)
        self.assertIsInstance(a.model, Pipeline); self.assertIsInstance(a.preprocessor, ColumnTransformer)
        self.assertEqual(type(a.model.named_steps['model']).__name__, 'LinearRegression'); self.assertRegex(a.fingerprint, r'^[0-9a-f]{12}$'); self.assertIsInstance(a.warnings, list)

    def test_feature_order_matches_training(self):
        a = load_artifacts(ART_DIR)
        self.assertEqual(list(a.model.named_steps['prep'].transformers_[0][2]), wf.FEATURES)
        self.assertEqual(list(a.preprocessor.transformers_[0][2]), wf.FEATURES); self.assertEqual(a.config['features'], wf.FEATURES)

    def test_preprocessor_artifact_equals_pipeline_preprocessing(self):
        a = load_artifacts(ART_DIR); s1, s2 = (x.named_transformers_['num'] for x in (a.model.named_steps['prep'], a.preprocessor))
        np.testing.assert_array_equal(s1.mean_, s2.mean_); np.testing.assert_array_equal(s1.scale_, s2.scale_)

    def test_missing_directory(self):
        e = self.fail(Path(tempfile.gettempdir()) / 'does_not_exist_wt', 'artifact_missing', model=False, preprocessor=False, config=False)
        self.assertIn(config.MODEL_FILE, e.message)

    def test_each_missing_file(self):
        for key, code in [('model', 'artifact_missing'), ('preprocessor', 'artifact_missing'), ('config', 'artifact_missing')]:
            with self.subTest(missing=key):
                e = self.fail(tmp_artifacts(self, skip=(A[key],)), code); self.assertFalse(e.loaded[key])
        self.fail(tmp_artifacts(self, skip=(A['preprocessor'],)), 'artifact_missing', model=True, preprocessor=False)

    def test_corrupt_model_file(self):
        d = tmp_artifacts(self); (d / A['model']).write_bytes(b'not a joblib file'); self.fail(d, 'model_load_failed', model=False)

    def test_corrupt_preprocessor_and_config(self):
        d = tmp_artifacts(self); (d / A['preprocessor']).write_bytes(b'garbage'); self.fail(d, 'preprocessor_load_failed', model=True, preprocessor=False)
        d = tmp_artifacts(self); (d / A['config']).write_text('{broken'); self.fail(d, 'config_load_failed', model=True, preprocessor=True, config=False)

    def test_wrong_estimator_type_rejected_no_fallback(self):
        d = tmp_artifacts(self); X = pd.DataFrame(np.random.RandomState(0).rand(20, 7) * 100, columns=wf.FEATURES)
        wrong = Pipeline([('prep', ColumnTransformer([('num', StandardScaler(), wf.FEATURES)])), ('model', Ridge())]).fit(X, X.sum(axis=1))
        joblib.dump(wrong, d / A['model']); self.fail(d, 'model_incompatible')
        from sklearn.linear_model import LinearRegression; joblib.dump(LinearRegression().fit(X, X.sum(axis=1)), d / A['model']); self.fail(d, 'model_incompatible')

    def test_model_that_violates_scoring_policy_rejected(self):
        d = tmp_artifacts(self); m = copy.deepcopy(ARTS.model); m.named_steps['model'].coef_ = m.named_steps['model'].coef_ + 1.0
        joblib.dump(m, d / A['model']); self.fail(d, 'model_incompatible')

    def test_preprocessor_mismatch_rejected(self):
        d = tmp_artifacts(self); p = copy.deepcopy(ARTS.preprocessor); p.named_transformers_['num'].scale_ = p.named_transformers_['num'].scale_ * 2
        joblib.dump(p, d / A['preprocessor']); self.fail(d, 'preprocessor_mismatch')

    def test_config_contract_mismatch_rejected(self):
        for mut in (lambda c: c.update(features=list(reversed(c['features']))), lambda c: c['weights'].update(urgency=0.31), lambda c: c.update(selected_model='Ridge Regression')):
            d = tmp_artifacts(self); c = copy.deepcopy(ARTS.config); mut(c); (d / A['config']).write_text(json.dumps(c))
            with self.assertRaises(ArtifactError) as cm: load_artifacts(d)
            self.assertIn(cm.exception.code, ('config_incompatible', 'model_incompatible'))

    def test_version_difference_is_a_warning_not_a_failure(self):
        d = tmp_artifacts(self); c = copy.deepcopy(ARTS.config); c['versions']['sklearn'] = '0.0.1'; (d / A['config']).write_text(json.dumps(c))
        a = load_artifacts(d); self.assertTrue(any('sklearn' in w for w in a.warnings))

    def test_loading_and_inference_never_modify_or_refit(self):
        before = {f: hashlib.sha256((ART_DIR / f).read_bytes()).hexdigest() for f in A.values()}
        a = load_artifacts(ART_DIR); sc = a.model.named_steps['prep'].named_transformers_['num']; m0, s0, c0 = sc.mean_.copy(), sc.scale_.copy(), a.model.named_steps['model'].coef_.copy()
        service.recommend(a, sess(), [task('A'), task('B', importance='Low')])
        np.testing.assert_array_equal(sc.mean_, m0); np.testing.assert_array_equal(sc.scale_, s0); np.testing.assert_array_equal(a.model.named_steps['model'].coef_, c0)
        self.assertEqual(before, {f: hashlib.sha256((ART_DIR / f).read_bytes()).hexdigest() for f in A.values()})

    def test_config_helpers(self):
        with mock.patch.dict(os.environ, {'WORKTODO_ARTIFACT_DIR': '/tmp/x', 'WORKTODO_STRICT_STARTUP': '1'}):
            self.assertEqual(config.artifact_dir(), Path('/tmp/x')); self.assertTrue(config.strict_startup())
        with mock.patch.dict(os.environ, {}, clear=True): self.assertEqual(config.artifact_dir(), config.ROOT / 'artifacts'); self.assertFalse(config.strict_startup())


class TestServiceLayer(unittest.TestCase):
    def rec(self, tasks, session=None, **kw): return service.recommend(ARTS, session or sess(), tasks, **kw)

    def test_response_shape_and_json_safety(self):
        r = self.rec([task('A'), task('B', importance='Low', task_name=None)]); json.dumps(r, allow_nan=False)
        self.assertEqual(set(r), {'ranked', 'excluded', 'summary'}); self.assertEqual(list(r['ranked'][0]), RANKED_FIELDS)
        self.assertEqual(set(r['summary']), {'total_tasks', 'eligible', 'excluded', 'returned', 'startable_now'})

    def test_scores_are_model_predictions_in_range(self):
        r = self.rec([task(f'T{i}', importance=['Low', 'High'][i % 2]) for i in range(5)])
        for x in r['ranked']:
            self.assertTrue(0 <= x['ml_score'] <= 100); self.assertTrue(all(0 <= x[f] <= 100 for f in wf.FEATURES))
            self.assertAlmostEqual(x['ml_score'], sum(wf.WEIGHTS[f] * x[f] for f in wf.FEATURES), places=6)

    def test_engine_vs_service_consistency_all_scenarios(self):
        for name, (session, tasks) in scenarios().items():
            with self.subTest(scenario=name):
                resp = json.loads(json.dumps(service.recommend(ARTS, session, tasks)))    # includes a JSON round trip, as over HTTP
                engine_compare(self, name, session, tasks, resp)

    def test_consistency_with_top_k(self):
        session, tasks = scenarios()['many']
        for k in (1, 3, 5, 1000):
            with self.subTest(top_k=k): engine_compare(self, 'many', session, tasks, json.loads(json.dumps(service.recommend(ARTS, session, tasks, top_k=k))), top_k=k)

    def test_consistency_on_fixture_tie_sessions_keeps_new_ordering(self):
        for f in FIXTURES:
            r = service.recommend(ARTS, f['session'], f['tasks']); self.assertEqual([x['rank'] for x in r['ranked']], list(range(1, len(r['ranked']) + 1)))

    def test_empty_all_excluded_and_zero_time(self):
        r = self.rec([]); self.assertEqual((r['ranked'], r['excluded'], r['summary']['total_tasks'], r['summary']['returned']), ([], [], 0, 0))
        r = self.rec([task('A', status='Completed'), task('B', dependency_status='Blocked')])
        self.assertEqual(r['ranked'], []); self.assertEqual({x['exclusion_reason'] for x in r['excluded']}, {'Task not active', 'Blocked dependency'})
        r = self.rec([task('A'), task('B')], sess(available_time_minutes=0, longest_free_slot_minutes=0))
        self.assertTrue(all(not x['startable_now'] and x['category'] == 'Schedule later' for x in r['ranked'])); self.assertEqual(r['summary']['startable_now'], 0)

    def test_excluded_tasks_never_in_ranked(self):
        r = self.rec(scenarios()['mixed_statuses'][1], scenarios()['mixed_statuses'][0])
        self.assertTrue({x['task_id'] for x in r['ranked']}.isdisjoint(x['task_id'] for x in r['excluded'])); self.assertEqual({x['task_id'] for x in r['excluded']}, {'C', 'D', 'E', 'F'})

    def test_ids_types_preserved_and_null_names(self):
        r = self.rec([task(2, task_name=None), task(1, task_name=None, importance='Low')])
        self.assertEqual([x['task_id'] for x in r['ranked']], [2, 1]); self.assertTrue(all(x['task_name'] is None for x in r['ranked']))

    def test_invalid_inputs_raise_engine_validation_errors(self):
        bad = {'invalid categorical': (task('A', importance='Urgent'), 'importance has invalid value'), 'duplicate ids': ([task('A'), task('A')], 'duplicate task_id'),
               'invalid due date': (task('A', due_date='nope'), 'due_date'), 'invalid start date': (task('A', start_date='2026-13-40'), 'start_date'),
               'negative duration': (task('A', estimated_duration_minutes=-5), 'negative'), 'zero duration': (task('A', estimated_duration_minutes=0), 'zero'),
               'splittable min > duration': (task('A', is_splittable=True, estimated_duration_minutes=20, minimum_session_minutes=30), 'must not exceed'),
               'missing status': (task('A', status=None), 'status is missing'), 'missing is_splittable': (task('A', is_splittable=None), 'is_splittable is missing'),
               'bad dependency': (task('A', dependency_status='blocked'), 'dependency_status')}
        for name, (t, text) in bad.items():
            with self.subTest(case=name):
                with self.assertRaises(wf.InputValidationError) as cm: self.rec(t if isinstance(t, list) else [t])
                self.assertIn(text, str(cm.exception))
        for kw, text in [(dict(available_time_minutes=-1), 'available_time_minutes'), (dict(current_time_period='Noon'), 'current_time_period'), (dict(session_timestamp='x'), 'session_timestamp')]:
            with self.subTest(session=kw), self.assertRaises(wf.InputValidationError) as cm: self.rec([task('A')], sess(**kw))
            self.assertIn(text, str(cm.exception))

    def test_omitted_vs_null_fields_follow_engine_rules(self):
        t = task('A'); del t['start_date']; del t['dependency_status']; self.assertEqual(len(self.rec([t])['ranked']), 1)
        t = task('A'); del t['status']
        with self.assertRaises(wf.InputValidationError): self.rec([t])

    def test_model_info_contents_and_no_internal_paths(self):
        info = service.model_info(ARTS); text = json.dumps(info)
        self.assertEqual(info['model_name'], 'Linear Regression'); self.assertEqual(info['model_type'], 'LinearRegression')
        self.assertEqual(info['weights'], wf.WEIGHTS); self.assertEqual([f['name'] for f in info['factors']], wf.FEATURES); self.assertAlmostEqual(sum(info['weights'].values()), 1.0)
        for leak in (str(ROOT), '/mnt', '.joblib', 'artifacts/', '/home'): self.assertNotIn(leak, text)


class TestErrorBodies(unittest.TestCase):
    def test_input_validation_body(self):
        try: service.recommend(ARTS, sess(), [task('A', status=None)])
        except wf.InputValidationError as e: status, b = input_validation_body(e)
        self.assertEqual(status, 422); self.assertEqual(b['error'], 'validation_error'); self.assertEqual(b['errors'][0]['field'], 'status'); self.assertIn('status is missing', b['errors'][0]['message'])

    def test_request_validation_body(self):
        s, b = request_validation_body([{'type': 'missing', 'loc': ('body', 'session'), 'msg': 'Field required'}, {'type': 'list_type', 'loc': ('body', 'tasks'), 'msg': 'Input should be a valid list'}])
        self.assertEqual(s, 422); self.assertEqual([e['field'] for e in b['errors']], ['session', 'tasks'])
        s, b = request_validation_body([{'type': 'json_invalid', 'loc': ('body', 5), 'msg': 'JSON decode error'}]); self.assertEqual((s, b['error']), (400, 'malformed_json'))
        self.assertNotIn('errors', b)

    def test_artifact_error_defaults(self):
        e = ArtifactError('x', 'm'); self.assertEqual(e.loaded, {'model': False, 'preprocessor': False, 'config': False})


class TestIntegrityAndStaticWiring(unittest.TestCase):
    def test_artifact_checksums_match_both_manifests(self):
        for man in ('backup/CHECKSUMS_before_stage2.sha256', 'backup/stage4_pre_api/MANIFEST.sha256'):
            for line in (ROOT / man).read_text().splitlines():
                d, name = line.split(maxsplit=1)
                if name.startswith('artifacts/'): self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), d, f'{man}: {name}')

    def test_engine_and_stage3_tests_unchanged_since_backup(self):
        for line in (ROOT / 'backup/stage4_pre_api/MANIFEST.sha256').read_text().splitlines():
            d, name = line.split(maxsplit=1)
            if not name.startswith('artifacts/'): self.assertEqual(hashlib.sha256((ROOT / name).read_bytes()).hexdigest(), d, name)

    def test_static_main_defines_required_routes_and_handlers(self):
        """STATIC check only (reads main.py text); does not execute FastAPI."""
        src = (ROOT / 'app' / 'main.py').read_text(); compile(src, 'main.py', 'exec')
        for needle in ("@app.get('/health'", "@app.get('/model-info'", "@app.post('/recommend'", 'InputValidationError', 'RequestValidationError', 'lifespan', 'strict_startup'):
            self.assertIn(needle, src)
        for forbidden in ('.fit(', '.fit_transform(', 'joblib.dump'): self.assertNotIn(forbidden, src + (ROOT / 'app' / 'service.py').read_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
