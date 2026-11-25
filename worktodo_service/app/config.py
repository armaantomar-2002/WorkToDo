import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODEL_FILE = 'worktodo_recommendation_model.joblib'
PREPROCESSOR_FILE = 'worktodo_preprocessor.joblib'
CONFIG_FILE = 'worktodo_training_config.json'
SERVICE_NAME = 'worktodo-ml-service'
API_VERSION = '1.0.0'


def artifact_dir() -> Path:
    """WORKTODO_ARTIFACT_DIR overrides the default ./artifacts."""
    return Path(os.environ.get('WORKTODO_ARTIFACT_DIR') or ROOT / 'artifacts')


def strict_startup() -> bool:
    """WORKTODO_STRICT_STARTUP=1 -> refuse to start if artifacts are missing/incompatible (default: start, /health reports 503)."""
    return os.environ.get('WORKTODO_STRICT_STARTUP', '0') == '1'
