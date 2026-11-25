"""Run: uvicorn fastapi_example_main:app --reload   (needs fastapi, uvicorn, pydantic>=2, scikit-learn, joblib, pandas; xgboost if selected)"""
from pathlib import Path
from typing import List, Optional
import joblib, pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel
import worktodo_features as wf

class Task(BaseModel):
    task_id: str; task_name: str = ''; start_date: str; due_date: Optional[str] = None
    importance: str; goal_contribution: str; consequence_of_delay: str; complexity: str
    estimated_duration_minutes: int; minimum_session_minutes: int; is_splittable: bool
    preferred_time: str; dependency_status: str; status: str

class Session(BaseModel):
    session_timestamp: str; available_time_minutes: int; longest_free_slot_minutes: int
    current_time_period: str; energy_level: str; focus_level: str

class RankRequest(BaseModel):
    session: Session; tasks: List[Task]; top_k: int = 5

app = FastAPI(title="WorkToDo ML scoring service")
model = joblib.load(Path(__file__).with_name("worktodo_recommendation_model.joblib"))  # load once at startup

@app.post("/rank")
def rank(req: RankRequest):
    ranked, excluded = wf.rank_tasks(pd.DataFrame([t.model_dump() for t in req.tasks]), req.session.model_dump(), model)
    cols = ["rank", "task_id", "task_name", "ml_score", "category", "reason"] + wf.FEATURES
    return {"ranked": ranked.head(req.top_k)[cols].to_dict("records") if len(ranked) else [], "excluded": excluded.to_dict("records")}
