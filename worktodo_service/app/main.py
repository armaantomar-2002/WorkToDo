"""FastAPI app. Run from worktodo_service/:  uvicorn app.main:app --port 8000"""
import logging, uuid
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
import worktodo_features as wf
from . import config, service
from .artifacts import load_artifacts
from .errors import ArtifactError, ServiceNotReady, body, input_validation_body, request_validation_body
from .schemas import ErrorResponse, HealthResponse, ModelInfoResponse, RecommendRequest, RecommendResponse

log = logging.getLogger('worktodo.api')
_ERR = {400: {'model': ErrorResponse}, 422: {'model': ErrorResponse}, 503: {'model': ErrorResponse}, 500: {'model': ErrorResponse}}


def create_app(artifact_dir=None, loader=load_artifacts):
    directory = Path(artifact_dir) if artifact_dir else config.artifact_dir()

    @asynccontextmanager
    async def lifespan(app):
        app.state.artifacts, app.state.startup_error = None, None
        try:
            app.state.artifacts = loader(directory)
            log.info('artifacts loaded (model %s)', app.state.artifacts.fingerprint)
        except ArtifactError as e:
            app.state.startup_error = e
            log.error('STARTUP CHECK FAILED [%s]: %s', e.code, e.message)
            if config.strict_startup(): raise
        except Exception:
            log.exception('STARTUP CHECK FAILED: unexpected error while loading artifacts')
            app.state.startup_error = ArtifactError('model_load_failed', 'Unexpected error while loading artifacts')
            if config.strict_startup(): raise
        yield

    app = FastAPI(title='WorkToDo ML Recommendation Service', version=config.API_VERSION, lifespan=lifespan)

    def ready(request: Request):
        art = getattr(request.app.state, 'artifacts', None)
        if art is None: raise ServiceNotReady()
        return art

    @app.exception_handler(wf.InputValidationError)
    async def _input_error(request, exc):
        status, b = input_validation_body(exc); return JSONResponse(b, status_code=status)

    @app.exception_handler(RequestValidationError)
    async def _request_error(request, exc):
        status, b = request_validation_body(exc.errors()); return JSONResponse(b, status_code=status)

    @app.exception_handler(ServiceNotReady)
    async def _not_ready(request, exc):
        return JSONResponse(body('service_unavailable', 'Model artifacts are not loaded; see /health'), status_code=503)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request, exc):
        return JSONResponse(body('http_error', str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unexpected(request, exc):
        error_id = uuid.uuid4().hex[:12]
        log.error('unexpected error %s on %s', error_id, request.url.path, exc_info=exc)
        return JSONResponse(body('internal_error', 'Unexpected server error', error_id=error_id), status_code=500)

    @app.get('/health', response_model=HealthResponse, responses={503: {'model': HealthResponse}})
    def health(request: Request):
        art, err = getattr(request.app.state, 'artifacts', None), getattr(request.app.state, 'startup_error', None)
        loaded = {'model': True, 'preprocessor': True, 'config': True} if art else (err.loaded if err else {})
        b = {'status': 'ok' if art else 'unavailable', 'api_running': True, 'model_loaded': bool(loaded.get('model')),
             'preprocessor_loaded': bool(loaded.get('preprocessor')), 'config_loaded': bool(loaded.get('config')), 'ready': art is not None,
             'warnings': art.warnings if art else [], 'error': None if art else {'code': err.code if err else 'not_started', 'message': err.message if err else 'Startup checks have not completed'}}
        return JSONResponse(b, status_code=200 if art else 503)

    @app.get('/model-info', response_model=ModelInfoResponse, responses=_ERR)
    def model_info(request: Request):
        return service.model_info(ready(request))

    @app.post('/recommend', response_model=RecommendResponse, responses=_ERR)
    def recommend(req: RecommendRequest, request: Request):
        art = ready(request)
        return service.recommend(art, req.session.model_dump(exclude_unset=True), [t.model_dump(exclude_unset=True) for t in req.tasks], req.top_k)

    return app


app = create_app()
