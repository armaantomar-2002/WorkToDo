"""Load and verify the existing fitted artifacts. Never fits/refits anything; never falls back to another model."""
import hashlib, json, logging
from dataclasses import dataclass, field
from pathlib import Path
import joblib, numpy as np, pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
import worktodo_features as wf
from . import config
from .errors import ArtifactError

log = logging.getLogger('worktodo.artifacts')
_EXPECTED_ESTIMATOR = {'Linear Regression': 'LinearRegression'}


@dataclass
class Artifacts:
    model: object                 # fitted sklearn Pipeline: ColumnTransformer('prep') -> LinearRegression('model')
    preprocessor: object          # fitted ColumnTransformer artifact (verified identical to model.prep)
    config: dict
    fingerprint: str              # first 12 hex chars of the model file SHA-256
    warnings: list = field(default_factory=list)


def _probe():
    rows = [[0] * 7, [100] * 7, [10, 20, 30, 40, 50, 60, 70], [95, 80, 75, 100, 25, 35, 90], [100, 20, 0, 13.3, 50, 35, 56.7]]
    return pd.DataFrame(rows, columns=wf.FEATURES, dtype=float)


def _verify(model, pre, cfg):
    if not isinstance(model, Pipeline) or list(model.named_steps) != ['prep', 'model']:
        raise ArtifactError('model_incompatible', 'Model artifact is not the expected preprocessing+regressor pipeline', {'model': True})
    expected = _EXPECTED_ESTIMATOR.get(cfg.get('selected_model'))
    if expected is None or type(model.named_steps['model']).__name__ != expected:
        raise ArtifactError('model_incompatible', 'Model type does not match the configured model (Linear Regression)', {'model': True, 'config': True})
    if not isinstance(pre, ColumnTransformer) or list(pre.transformers_[0][2]) != wf.FEATURES or \
            list(model.named_steps['prep'].transformers_[0][2]) != wf.FEATURES:
        raise ArtifactError('preprocessor_mismatch', 'Preprocessor feature order does not match the seven recommendation factors', {'model': True, 'preprocessor': True, 'config': True})
    if cfg.get('features') != wf.FEATURES or cfg.get('weights') != wf.WEIGHTS:
        raise ArtifactError('config_incompatible', 'Training configuration factors/weights do not match the engine', {'model': True, 'preprocessor': True, 'config': True})
    p = _probe()
    try:
        a, b = model.named_steps['prep'].transform(p), pre.transform(p)
        pred, chain = model.predict(p), model.named_steps['model'].predict(b)
    except Exception as e:
        log.exception('probe inference failed'); raise ArtifactError('model_incompatible', 'Model/preprocessor failed a smoke-test prediction', {'model': True, 'preprocessor': True, 'config': True}) from e
    if not np.allclose(a, b):
        raise ArtifactError('preprocessor_mismatch', 'Preprocessor artifact differs from the preprocessing inside the model', {'model': True, 'preprocessor': True, 'config': True})
    if not np.allclose(pred, chain):
        raise ArtifactError('model_incompatible', 'Model pipeline prediction is inconsistent with preprocessor + regressor', {'model': True, 'preprocessor': True, 'config': True})
    if not np.allclose(pred, wf.weighted_score(p).to_numpy(), atol=1e-4):
        raise ArtifactError('model_incompatible', 'Model does not reproduce the agreed weighted scoring policy on smoke-test inputs', {'model': True, 'preprocessor': True, 'config': True})


def load_artifacts(directory) -> Artifacts:
    d = Path(directory)
    paths = {'model': d / config.MODEL_FILE, 'preprocessor': d / config.PREPROCESSOR_FILE, 'config': d / config.CONFIG_FILE}
    loaded, objs = {}, {}
    for key, path in paths.items():
        if not path.is_file():
            raise ArtifactError('artifact_missing', f'Required artifact missing: {path.name}', loaded)
        try:
            objs[key] = json.loads(path.read_text()) if key == 'config' else joblib.load(path)
        except Exception as e:
            log.exception('failed to load %s', path.name)
            raise ArtifactError(f'{key}_load_failed', f'Could not load artifact: {path.name}', loaded) from e
        loaded[key] = True
    _verify(objs['model'], objs['preprocessor'], objs['config'])
    warns = []
    for lib, installed in (('sklearn', sklearn.__version__), ('pandas', pd.__version__), ('numpy', np.__version__)):
        trained = (objs['config'].get('versions') or {}).get(lib)
        if trained and trained != installed: warns.append(f'{lib} version differs from training ({trained} -> {installed})')
    fp = hashlib.sha256(paths['model'].read_bytes()).hexdigest()[:12]
    return Artifacts(objs['model'], objs['preprocessor'], objs['config'], fp, warns)
