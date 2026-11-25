"""Pydantic schemas. Requests are structural only: domain validation stays in the engine (InputValidationError) so rules are unchanged."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class TaskIn(BaseModel):
    model_config = ConfigDict(extra='allow')
    task_id: Any = None; task_name: Any = None; start_date: Any = None; due_date: Any = None
    importance: Any = None; goal_contribution: Any = None; consequence_of_delay: Any = None; complexity: Any = None
    estimated_duration_minutes: Any = None; minimum_session_minutes: Any = None; is_splittable: Any = None
    preferred_time: Any = None; dependency_status: Any = None; status: Any = None


class SessionIn(BaseModel):
    model_config = ConfigDict(extra='allow')
    session_timestamp: Any = None; available_time_minutes: Any = None; longest_free_slot_minutes: Any = None
    current_time_period: Any = None; energy_level: Any = None; focus_level: Any = None


class RecommendRequest(BaseModel):
    session: SessionIn
    tasks: List[TaskIn]
    top_k: Optional[int] = Field(default=None, ge=1, description='Return only the first k ranked tasks (default: all)')


class RankedTask(BaseModel):
    rank: int; task_id: Any; task_name: Any = None; ml_score: float; category: str; startable_now: bool; reason: str
    urgency: float; importance: float; goal_contribution: float; feasibility: float
    consequence_of_delay: float; timing_suitability: float; energy_suitability: float


class ExcludedTask(BaseModel):
    task_id: Any; exclusion_reason: str


class Summary(BaseModel):
    total_tasks: int; eligible: int; excluded: int; returned: int; startable_now: int


class RecommendResponse(BaseModel):
    ranked: List[RankedTask]; excluded: List[ExcludedTask]; summary: Summary


class HealthResponse(BaseModel):
    status: str; api_running: bool; model_loaded: bool; preprocessor_loaded: bool; config_loaded: bool; ready: bool
    warnings: List[str] = []; error: Optional[Dict[str, str]] = None


class FactorInfo(BaseModel):
    name: str; weight: float


class ModelInfoResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())   # fields named model_name/model_type
    model_name: Optional[str]; model_type: str; framework: str; factors: List[FactorInfo]; weights: Dict[str, float]
    score_range: List[int]; trained_at: Optional[str] = None; artifact_fingerprint: str; api_version: str; notes: List[str] = []


class ErrorResponse(BaseModel):
    error: str; message: str; errors: Optional[List[Dict[str, Any]]] = None; error_id: Optional[str] = None
