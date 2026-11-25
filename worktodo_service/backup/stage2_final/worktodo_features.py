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
    return np.clip(np.where(d <= L, 100.0, np.where(s & (m <= L), 60 + 30 * ratio, 40 * ratio)), 0.0, 100.0)


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
    start = pd.to_datetime(df['start_date']) if 'start_date' in df else pd.Series(pd.NaT, index=df.index)
    blocked = df['dependency_status'].eq('Blocked') if 'dependency_status' in df else pd.Series(False, index=df.index)
    reason = np.select([~df['status'].isin(ACTIVE_STATUSES), blocked, start > today],
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


DEPENDENCY_VALUES = {'No dependency', 'Ready', 'Blocked'}
TASK_REQUIRED = ['task_id', 'importance', 'goal_contribution', 'consequence_of_delay', 'complexity',
                 'estimated_duration_minutes', 'is_splittable', 'preferred_time', 'status']
SESSION_REQUIRED = ['session_timestamp', 'available_time_minutes', 'longest_free_slot_minutes', 'current_time_period',
                    'energy_level', 'focus_level']
RANKED_COLUMNS = ['rank', 'task_id', 'task_name', 'ml_score', 'category', 'startable_now', 'reason'] + FEATURES + \
                 ['days_until_deadline', 'effective_min_session_minutes']


class InputValidationError(ValueError):
    """Raised for invalid request data; .errors lists every problem found (API layer should return HTTP 422)."""
    def __init__(self, errors):
        self.errors = list(errors)
        super().__init__('Invalid input: ' + '; '.join(self.errors))


def _isnull(v):
    return v is None or (not isinstance(v, (str, bytes)) and bool(pd.isna(v)))


def _is_boolish(v):
    return isinstance(v, (bool, np.bool_)) or (isinstance(v, (int, np.integer)) and v in (0, 1))


def _numeric(s):
    """-> (numeric series, mask of non-null values that are not finite numbers)."""
    s = pd.Series(s, dtype=object)
    n = pd.to_numeric(s.where(~s.map(lambda v: isinstance(v, (bool, np.bool_))), None), errors='coerce').astype('float64')
    return n, (s.notna() & ~np.isfinite(n))


def _parse_dates(s):
    """-> (naive datetimes, mask of non-null unparseable values, issue text or None)."""
    s = pd.Series(s, dtype=object)
    try:
        parsed = pd.to_datetime(s, errors='coerce', format='mixed')
    except (ValueError, TypeError):
        return pd.Series(pd.NaT, index=s.index), s.notna(), 'unparseable or mixed-timezone values'
    if not pd.api.types.is_datetime64_any_dtype(parsed):
        return pd.Series(pd.NaT, index=s.index), s.notna(), 'unparseable or mixed-timezone values'
    if getattr(parsed.dt, 'tz', None) is not None:
        return parsed.dt.tz_localize(None), s.notna() & False, 'timezone offsets are not supported; send local date/time without a timezone'
    return parsed, s.notna() & parsed.isna(), None


def _ids(df, mask):
    v = [str(x) for x in df.loc[mask, 'task_id']]
    return 'task_id: ' + ', '.join(v[:5]) + (f' (+{len(v) - 5} more)' if len(v) > 5 else '')


def validate_session(session):
    """Returns a cleaned copy of the session fields, or raises InputValidationError listing all problems."""
    if not hasattr(session, 'get'):
        raise InputValidationError(['session must be an object/dict'])
    errs, out = [], {}
    for k in SESSION_REQUIRED:
        if _isnull(session.get(k)): errs.append(f'{k} is missing')
        else: out[k] = session[k]
    if 'session_timestamp' in out:
        ts, bad, issue = _parse_dates([out['session_timestamp']])
        if issue: errs.append(f'session_timestamp: {issue}')
        elif bad.iloc[0] or ts.isna().iloc[0]: errs.append(f"session_timestamp is not a valid date/time ({out['session_timestamp']!r})")
        else: out['session_timestamp'] = ts.iloc[0]
    for k in ('available_time_minutes', 'longest_free_slot_minutes'):
        if k in out:
            n, bad = _numeric([out[k]])
            if bad.iloc[0] or n.isna().iloc[0]: errs.append(f'{k} must be a number ({out[k]!r})')
            elif n.iloc[0] < 0: errs.append(f'{k} must not be negative ({out[k]!r}); zero is allowed')
            else: out[k] = float(n.iloc[0])
    for k, allowed in (('current_time_period', PERIODS), ('energy_level', set(LEVEL)), ('focus_level', set(LEVEL))):
        if k in out and out[k] not in allowed: errs.append(f'{k} {out[k]!r} is invalid; allowed: {sorted(allowed)}')
    if errs: raise InputValidationError(errs)
    return out


def validate_tasks(tasks):
    """Returns a cleaned copy (typed numbers/dates/bools, defaults for omitted optional fields) or raises
    InputValidationError listing all problems. Optional/nullable: task_name, start_date, due_date, dependency_status;
    minimum_session_minutes is required only for splittable tasks."""
    df = tasks.copy().reset_index(drop=True)
    missing = [c for c in TASK_REQUIRED if c not in df.columns]
    if missing: raise InputValidationError([f"missing required task field(s): {', '.join(missing)}"])
    for c in ('task_name', 'start_date', 'due_date', 'dependency_status', 'minimum_session_minutes'):
        if c not in df.columns: df[c] = '' if c == 'task_name' else None
    errs = []
    idbad = df['task_id'].map(_isnull) | df['task_id'].map(lambda v: isinstance(v, str) and not v.strip())
    if idbad.any(): errs.append(f'task_id is missing or blank (row(s) {list(df.index[idbad][:5])})')
    ids = df.loc[~idbad, 'task_id'].astype(str); dup = ids[ids.duplicated(keep=False)]
    if len(dup): errs.append('duplicate task_id: ' + ', '.join(sorted(set(dup))[:5]))
    for c in TASK_REQUIRED[1:]:
        m = df[c].map(_isnull)
        if m.any(): errs.append(f'{c} is missing ({_ids(df, m)})')
    # is_splittable
    spl_null = df['is_splittable'].map(_isnull)
    spl_ok = df['is_splittable'].map(lambda v: not _isnull(v) and _is_boolish(v))
    bad = ~spl_ok & ~spl_null
    if bad.any(): errs.append(f'is_splittable must be true or false ({_ids(df, bad)})')
    spl = spl_ok & df['is_splittable'].map(lambda v: _is_boolish(v) and bool(v))
    # durations
    d, dbad = _numeric(df['estimated_duration_minutes']); dnull = df['estimated_duration_minutes'].map(_isnull)
    if dbad.any(): errs.append(f'estimated_duration_minutes must be a number ({_ids(df, dbad)})')
    if (d < 0).any(): errs.append(f'estimated_duration_minutes must not be negative ({_ids(df, d < 0)})')
    if (d == 0).any(): errs.append(f'estimated_duration_minutes must not be zero ({_ids(df, d == 0)})')
    m, mbad = _numeric(df['minimum_session_minutes'])
    mprob = spl & (m.isna() | mbad | (m <= 0))
    if mprob.any(): errs.append(f'minimum_session_minutes must be a number greater than 0 for splittable tasks ({_ids(df, mprob)})')
    # dependency / dates
    dep = df['dependency_status'].where(~df['dependency_status'].map(_isnull), 'No dependency')
    badd = ~dep.isin(DEPENDENCY_VALUES)
    if badd.any(): errs.append(f'dependency_status invalid; allowed {sorted(DEPENDENCY_VALUES)} or null ({_ids(df, badd)})')
    parsed = {}
    for c in ('start_date', 'due_date'):
        parsed[c], bm, issue = _parse_dates(df[c])
        if issue: errs.append(f'{c}: {issue}')
        if bm.any(): errs.append(f'{c} is not a valid date ({_ids(df, bm)})')
    if errs: raise InputValidationError(errs)
    df['estimated_duration_minutes'] = d
    df['is_splittable'] = spl.astype(bool)
    df['minimum_session_minutes'] = np.where(spl, m, d)
    df['dependency_status'] = dep
    df['start_date'], df['due_date'] = parsed['start_date'], parsed['due_date']
    return df


def effective_min_session(duration, min_session, splittable):
    """Minutes that must fit in the uninterrupted slot to start: the FULL duration for nonsplittable tasks;
    for splittable tasks the minimum useful session (never more than the whole task)."""
    d = np.asarray(duration, float); m = np.asarray(min_session, float)
    return np.where(np.asarray(splittable, bool), np.minimum(m, d), d)


def _empty_ranked():
    return pd.DataFrame(columns=RANKED_COLUMNS)


def _empty_excluded():
    return pd.DataFrame(columns=['task_id', 'exclusion_reason'])


def assign_categories(ranked, n_now=1, n_next=2):
    """Illustrative deterministic rule (confirm before production): best startable task = Do now, next
    n_next startable tasks = Do next, everything else (incl. high scorers that cannot start now) = Schedule later."""
    ok = ranked['startable_now'].to_numpy(); cs = np.cumsum(ok)
    return np.where(ok & (cs <= n_now), 'Do now', np.where(ok & (cs <= n_now + n_next), 'Do next', 'Schedule later'))


def rank_tasks(tasks, session, model, n_now=1, n_next=2):
    """tasks: DataFrame or list of dicts (task_id, task_name, start_date, due_date, importance, goal_contribution,
    consequence_of_delay, complexity, estimated_duration_minutes, minimum_session_minutes, is_splittable, preferred_time,
    dependency_status, status). session: dict (session_timestamp, available_time_minutes, longest_free_slot_minutes,
    current_time_period, energy_level, focus_level). Returns (ranked, excluded). ML scores; deterministic rules decide
    eligibility/category. Raises InputValidationError (a ValueError) for invalid input; empty task list -> empty results."""
    if not isinstance(tasks, pd.DataFrame):
        tasks = pd.DataFrame(tasks)
    serr, terr, sess, df = [], [], None, None
    try:
        sess = validate_session(session)
    except InputValidationError as e:
        serr = e.errors
    if len(tasks) > 0:
        try:
            df = validate_tasks(tasks)
        except InputValidationError as e:
            terr = e.errors
    if serr or terr:
        raise InputValidationError(serr + terr)          # session and task problems reported together
    if len(tasks) == 0:
        return _empty_ranked(), _empty_excluded()
    for k, v in sess.items():
        df[k] = v
    df['exclusion_reason'] = eligibility(df)
    excluded = df[df['exclusion_reason'] != ''][['task_id', 'exclusion_reason']].reset_index(drop=True)
    df = df[df['exclusion_reason'] == ''].reset_index(drop=True)
    if df.empty:
        return _empty_ranked(), excluded
    F = build_features(df)
    df['importance_label'], df['goal_label'], df['consequence_label'] = df['importance'], df['goal_contribution'], df['consequence_of_delay']
    df = pd.concat([df.drop(columns=['importance', 'goal_contribution', 'consequence_of_delay']), F], axis=1)
    df['ml_score'] = predict_scores(model, F)
    df['days_until_deadline'] = days_until_deadline(df['due_date'], df['session_timestamp'])
    df['_score_r'], df['_tid'] = df['ml_score'].round(6), df['task_id'].astype(str)   # tie-break keys only; ml_score stays unrounded
    df = df.sort_values(['_score_r', 'urgency', '_tid'], ascending=[False, False, True], kind='mergesort').drop(columns=['_score_r', '_tid']).reset_index(drop=True)
    df.insert(0, 'rank', np.arange(1, len(df) + 1))
    slot = np.minimum(df['longest_free_slot_minutes'], df['available_time_minutes'])
    df['effective_min_session_minutes'] = effective_min_session(df['estimated_duration_minutes'], df['minimum_session_minutes'], df['is_splittable'])
    df['startable_now'] = df['effective_min_session_minutes'] <= slot
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
