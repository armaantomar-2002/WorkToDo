"""Error types and framework-independent error-body builders (unit-testable without FastAPI)."""
import re
import worktodo_features as wf

_KNOWN_FIELDS = set(wf.TASK_REQUIRED) | set(wf.SESSION_REQUIRED) | {'task_name', 'start_date', 'due_date', 'dependency_status', 'minimum_session_minutes'}


class ArtifactError(Exception):
    """Artifact missing/unloadable/incompatible. .message is client-safe (no paths); .loaded says which parts loaded."""
    def __init__(self, code, message, loaded=None):
        super().__init__(message)
        self.code, self.message = code, message
        self.loaded = {'model': False, 'preprocessor': False, 'config': False, **(loaded or {})}


class ServiceNotReady(Exception):
    pass


def body(error, message, errors=None, error_id=None):
    b = {'error': error, 'message': message}
    if errors is not None: b['errors'] = errors
    if error_id: b['error_id'] = error_id
    return b


def input_validation_body(exc):
    """wf.InputValidationError -> (422, body). Messages are the engine's own, unchanged."""
    errs = []
    for m in exc.errors:
        first = re.match(r'[a-z_]+', m)
        errs.append({'field': first.group(0) if first and first.group(0) in _KNOWN_FIELDS else None, 'message': m})
    return 422, body('validation_error', 'Request validation failed', errs)


def request_validation_body(pydantic_errors):
    """FastAPI RequestValidationError.errors() -> (status, body): 400 malformed JSON, 422 structural problems."""
    if any(e.get('type') == 'json_invalid' for e in pydantic_errors):
        return 400, body('malformed_json', 'Request body is not valid JSON')
    errs = []
    for e in pydantic_errors:
        loc = [str(p) for p in e.get('loc', ())]
        if loc and loc[0] == 'body': loc = loc[1:]
        errs.append({'field': '.'.join(loc) or None, 'message': str(e.get('msg', 'invalid value'))})
    return 422, body('validation_error', 'Request validation failed', errs)
