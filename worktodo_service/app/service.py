"""Thin adapter: calls the existing engine (wf.rank_tasks) and makes its output JSON-safe. No scoring logic here."""
import math
import numpy as np
import worktodo_features as wf
from . import config

RANKED_FIELDS = ['rank', 'task_id', 'task_name', 'ml_score', 'category', 'startable_now', 'reason'] + wf.FEATURES


def _clean(v):
    if isinstance(v, np.generic): v = v.item()
    if v is None or (isinstance(v, float) and not math.isfinite(v)): return None
    return v


def recommend(art, session, tasks, top_k=None):
    """Raises wf.InputValidationError for invalid input. Scores are the model's unrounded predictions."""
    ranked, excluded = wf.rank_tasks(tasks, session, art.model)
    items = [{k: _clean(v) for k, v in rec.items()} for rec in ranked[RANKED_FIELDS].to_dict('records')]
    if top_k is not None: items = items[:top_k]
    return {'ranked': items,
            'excluded': [{k: _clean(v) for k, v in rec.items()} for rec in excluded.to_dict('records')],
            'summary': {'total_tasks': len(tasks), 'eligible': int(len(ranked)), 'excluded': int(len(excluded)), 'returned': len(items),
                        'startable_now': int(ranked['startable_now'].astype(bool).sum()) if len(ranked) else 0}}


def model_info(art):
    cfg = art.config
    return {'model_name': cfg.get('selected_model'), 'model_type': type(art.model.named_steps['model']).__name__, 'framework': 'scikit-learn',
            'factors': [{'name': k, 'weight': w} for k, w in wf.WEIGHTS.items()], 'weights': dict(wf.WEIGHTS), 'score_range': [0, 100],
            'trained_at': cfg.get('created_utc'), 'artifact_fingerprint': art.fingerprint, 'api_version': config.API_VERSION,
            'notes': list(cfg.get('limitations') or [])}
