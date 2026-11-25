"""WorkToDo seven-factor feature engineering + ranking helpers (usable outside Colab / in FastAPI)."""
import numpy as np
import pandas as pd

WEIGHTS = {'urgency': 0.30, 'importance': 0.20, 'goal_contribution': 0.15, 'feasibility': 0.15,
           'consequence_of_delay': 0.10, 'timing_suitability': 0.05, 'energy_suitability': 0.05}
FEATURES = list(WEIGHTS)
IMPORTANCE_MAP = {'Critical': 100, 'High': 80, 'Medium': 50, 'Low': 20}
GOAL_MAP = {'Essential': 100, 'High': 75, 'Medium': 50, 'Low': 25, 'No linked goal': 0}
CONSEQUENCE_MAP = {'Major': 100, 'Significant': 75, 'Moderate': 50, 'Minor': 25, 'None': 0, 'No consequence': 0}
LEVEL = {'Low': 0, 'Medium': 1, 'High': 2}            # user energy / focus
REQUIREMENT = {'Simple': 0, 'Moderate': 1, 'Complex': 2}  # task demand
# LEVEL_MATCH[user_level, task_demand] -> 0-100 fit (symmetric; exact match = 100). Constants are inherited from
# the dataset's feature generator (not derived from real behaviour) -> review before production.
LEVEL_MATCH = np.array([[100.0, 67.5, 170 / 3], [67.5, 100.0, 235 / 3], [170 / 3, 235 / 3, 100.0]])
PERIODS = {'Morning', 'Afternoon', 'Evening', 'Night'}
ACTIVE_STATUSES = {'Pending', 'In Progress'}


def _map(s, mapping, name):
    s = pd.Series(s)
    out = s.map(mapping)
    if out.isna().any():
        raise ValueError(f"{name}: unmapped/missing values {sorted(map(str, s[out.isna()].unique()))}")
    return out.astype(float)


def days_until_deadline(due_date, session_timestamp):
    due = pd.to_datetime(pd.Series(due_date)).dt.normalize()
    now = pd.to_datetime(pd.Series(session_timestamp)).dt.normalize()
    return (due - now).dt.days.astype('float64')


def urgency_score(days):
    d = pd.Series(days, dtype='float64')
    conds = [d.isna(), d < 0, d == 0, d == 1, d <= 3, d <= 7, d <= 14]
    return pd.Series(np.select(conds, [10, 100, 95, 85, 70, 50, 30], default=15), index=d.index, dtype=float)


def feasibility_score(duration, min_session, splittable, longest_slot, available=None):
    """100 = whole task fits the longest uninterrupted slot; 60-90 = splittable and a useful first session fits
    (partial progress); 0-40 = cannot meaningfully start (scaled by slot/duration). Total free time is NOT used."""
    d = np.asarray(duration, float); m = np.asarray(min_session, float)
    L = np.asarray(longest_slot, float); s = np.asarray(splittable, bool)
    if available is not None:
        L = np.minimum(L, np.asarray(available, float))
    ratio = np.divide(L, d, out=np.zeros_like(L), where=d > 0)
    return np.where(d <= L, 100.0, np.where(s & (m <= L), 60 + 30 * ratio, 40 * ratio))


def timing_score(preferred, current):
    p = np.asarray(preferred, dtype=object); c = np.asarray(current, dtype=object)
    return np.where(p == 'Anytime', 70.0, np.where(p == c, 100.0, 35.0))


def energy_score(energy, focus, complexity):
    e = _map(energy, LEVEL, 'energy_level').astype(int).to_numpy()
    f = _map(focus, LEVEL, 'focus_level').astype(int).to_numpy()
    r = _map(complexity, REQUIREMENT, 'complexity').astype(int).to_numpy()
    return (LEVEL_MATCH[e, r] + LEVEL_MATCH[f, r]) / 2


def build_features(df):
    """df needs raw task + session columns (see rank_tasks). Returns the seven 0-100 factors."""
    idx = df.index
    days = days_until_deadline(df['due_date'], df['session_timestamp']).set_axis(idx)
    out = pd.DataFrame(index=idx)
    out['urgency'] = urgency_score(days)
    out['importance'] = _map(df['importance'], IMPORTANCE_MAP, 'importance').set_axis(idx)
    out['goal_contribution'] = _map(df['goal_contribution'], GOAL_MAP, 'goal_contribution').set_axis(idx)
    out['feasibility'] = feasibility_score(df['estimated_duration_minutes'], df['minimum_session_minutes'],
                                           df['is_splittable'], df['longest_free_slot_minutes'],
                                           df['available_time_minutes'])
    out['consequence_of_delay'] = _map(df['consequence_of_delay'], CONSEQUENCE_MAP, 'consequence_of_delay').set_axis(idx)
    if not set(df['preferred_time'].unique()) <= PERIODS | {'Anytime'}:
        raise ValueError('unknown preferred_time')
    out['timing_suitability'] = timing_score(df['preferred_time'], df['current_time_period'])
    out['energy_suitability'] = energy_score(df['energy_level'], df['focus_level'], df['complexity'])
    return out[FEATURES]


def weighted_score(F):
    return F[FEATURES].mul(pd.Series(WEIGHTS)).sum(axis=1)


def eligibility(df):
    """Hard rules, independent of ML. Returns exclusion reason ('' = eligible)."""
    today = pd.to_datetime(df['session_timestamp']).dt.normalize()
    start = pd.to_datetime(df['start_date'])
    reason = np.select([~df['status'].isin(ACTIVE_STATUSES), df['dependency_status'].eq('Blocked'), start > today],
                       ['Task not active', 'Blocked dependency', 'Start date in future'], default='')
    return pd.Series(reason, index=df.index)


def predict_scores(model, F):
    return np.clip(model.predict(F[FEATURES]), 0, 100)


def _urgency_text(d):
    if pd.isna(d): return 'no deadline'
    d = int(d)
    return f'overdue by {-d} day(s)' if d < 0 else ('due today' if d == 0 else f'due in {d} day(s)')


def _factor_text(name, r):
    v = r[name]
    if name == 'urgency': return _urgency_text(r['days_until_deadline'])
    if name == 'importance': return f"{r['importance_label']} importance"
    if name == 'goal_contribution': return 'no linked goal' if v == 0 else f"{r['goal_label']} goal contribution"
    if name == 'consequence_of_delay':
        if r['consequence_label'] in ['None', 'No consequence']:
            return 'No consequence if delayed'
        return f"{r['consequence_label']} consequence if delayed"
    # if name == 'consequence_of_delay': return f"{r['consequence_label']} consequence if delayed"
    if name == 'feasibility':
        return 'fits the longest free slot' if v == 100 else ('partial progress possible in the free slot' if v >= 60
                                                              else 'does not fit the free slot')
    if name == 'timing_suitability':
        return 'matches preferred time of day' if v == 100 else ('Anytime task' if v == 70
                                                                 else f"preferred time ({r['preferred_time']}) differs from now")
    return f'energy/focus fit {v:.0f}/100'


def assign_categories(ranked, n_now=1, n_next=2):
    """Illustrative deterministic rule (confirm before production): best startable task = Do now, next
    n_next startable tasks = Do next, everything else (incl. high scorers that cannot start now) = Schedule later."""
    ok = ranked['startable_now'].to_numpy(); cs = np.cumsum(ok)
    return np.where(ok & (cs <= n_now), 'Do now', np.where(ok & (cs <= n_now + n_next), 'Do next', 'Schedule later'))


def rank_tasks(tasks, session, model, n_now=1, n_next=2):
    """tasks: DataFrame (task_id, task_name, start_date, due_date, importance, goal_contribution, consequence_of_delay,
    complexity, estimated_duration_minutes, minimum_session_minutes, is_splittable, preferred_time, dependency_status,
    status). session: dict (session_timestamp, available_time_minutes, longest_free_slot_minutes, current_time_period,
    energy_level, focus_level). Returns (ranked, excluded). ML scores; deterministic rules decide eligibility/category."""
    df = tasks.copy().reset_index(drop=True)
    for k, v in session.items():
        df[k] = v
    df['exclusion_reason'] = eligibility(df)
    excluded = df[df['exclusion_reason'] != ''][['task_id', 'exclusion_reason']].reset_index(drop=True)
    df = df[df['exclusion_reason'] == ''].reset_index(drop=True)
    if df.empty:
        return df, excluded
    F = build_features(df)
    df['importance_label'], df['goal_label'], df['consequence_label'] = df['importance'], df['goal_contribution'], df['consequence_of_delay']
    df = pd.concat([df.drop(columns=['importance', 'goal_contribution', 'consequence_of_delay']), F], axis=1)
    df['ml_score'] = predict_scores(model, F)
    df['days_until_deadline'] = days_until_deadline(df['due_date'], df['session_timestamp'])
    df = df.sort_values(['ml_score', 'urgency'], ascending=False, kind='mergesort').reset_index(drop=True)
    df.insert(0, 'rank', np.arange(1, len(df) + 1))
    slot = np.minimum(df['longest_free_slot_minutes'], df['available_time_minutes'])
    df['startable_now'] = df['minimum_session_minutes'] <= slot
    df['category'] = assign_categories(df, n_now, n_next)
    reasons = []
    for _, r in df.iterrows():
        contrib = {k: WEIGHTS[k] * r[k] for k in FEATURES}
        top = sorted(contrib, key=contrib.get, reverse=True)[:3]
        weak = [k for k in FEATURES if r[k] <= 40 and k not in top and WEIGHTS[k] >= 0.05]
        txt = 'Drivers: ' + '; '.join(_factor_text(k, r) for k in top) + '.'
        if weak: txt += ' Held back by: ' + '; '.join(_factor_text(k, r) for k in weak) + '.'
        reasons.append(txt)
    df['reason'] = reasons
    return df, excluded
