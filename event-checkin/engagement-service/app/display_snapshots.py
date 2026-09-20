"""Short-lived, shared snapshots for the public projector surface only.

Authorization stays in the HTTP routes. No guest state, staff results, tokens,
raw text, or per-display settings enter this cache. A distributed lock shares
aggregation across replicas; a bounded local cache also coalesces requests when
Redis is unavailable. Generation checks prevent an old build repopulating the
cache after a response, moderation decision, or presenter command.
"""
import asyncio
import copy
import json
import secrets
import time
import weakref
from collections import OrderedDict

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

from .config import settings
from .metrics import DISPLAY_SNAPSHOT_BUILDS, DISPLAY_SNAPSHOT_HITS

_FIELDS = {
    'event_id', 'activity_id', 'title', 'description', 'type', 'status',
    'current_question_id', 'participant_count', 'response_count',
    'activity_summary', 'survey_summary', 'display_config', 'questions',
    'leaderboard', 'featured_qna', 'word_cloud', 'ai_insight', 'room_pulse', 'teams',
}
_CONFIG_FIELDS = {
    'event_name', 'event_venue', 'start_at', 'join_code', 'leaderboard_enabled',
    'display_scene', 'moderation_enabled', 'live_results_enabled',
    'registered_progress_mode', 'survey_insights_layout', 'show_mode',
    'show_phase', 'show_phase_started_at', 'show_phase_deadline_at',
    'show_automation_enabled', 'show_automation_timings',
}
_local = OrderedDict()
_locks = weakref.WeakValueDictionary()
_redis_retry_at = 0.0


def _redis():
    # Avoid the realtime -> invalidation -> realtime import cycle.
    from .realtime import redis
    return redis


def _version_key(activity_id):
    return f'engagement:public-snapshot-version:{activity_id}'


def _safe_payload(payload):
    result = jsonable_encoder({key: value for key, value in payload.items() if key in _FIELDS})
    result['display_config'] = {key: value for key, value in result.get('display_config', {}).items() if key in _CONFIG_FIELDS}
    for question in result.get('questions', []):
        question['text_samples'] = []
    return result


def _remember(key, value):
    _local[key] = (time.monotonic() + settings.display_snapshot_ttl_ms / 1000, copy.deepcopy(value))
    _local.move_to_end(key)
    while len(_local) > 512:
        _local.popitem(last=False)


async def invalidate_public_snapshot(activity_id, event=None):
    global _redis_retry_at
    for key in list(_local):
        if key[2] == activity_id:
            _local.pop(key, None)
    for key, lock in list(_locks.items()):
        if key[2] == activity_id:
            lock.snapshot_generation = getattr(lock, 'snapshot_generation', 0) + 1
    try:
        if event != 'response.submitted':
            await _redis().incr(_version_key(activity_id) + ':control')
            await _redis().expire(_version_key(activity_id) + ':control', 86400)
        await _redis().incr(_version_key(activity_id))
        await _redis().expire(_version_key(activity_id), 86400)
    except Exception:
        _redis_retry_at = time.monotonic() + 1


async def public_activity_snapshot(activity, build):
    """Cache only the already-filtered public activity projection from build()."""
    global _redis_retry_at
    scope = (activity.org_id, activity.event_id, activity.id)
    lock = _locks.get(scope)
    if lock is None:
        lock = asyncio.Lock()
        _locks[scope] = lock
    async with lock:
        use_redis = time.monotonic() >= _redis_retry_at
        version = '0'
        lock_token = None
        cache_key = None
        lock_key = f'engagement:public-snapshot-lock:{activity.id}'
        deadline = time.monotonic() + 3
        while use_redis:
            try:
                version = str(await _redis().get(_version_key(activity.id)) or '0')
                cache_key = 'engagement:public-snapshot:' + ':'.join(scope) + ':' + version
                cached = await _redis().get(cache_key)
                if cached:
                    if str(await _redis().get(_version_key(activity.id)) or '0') != version:
                        continue
                    DISPLAY_SNAPSHOT_HITS.labels('shared').inc()
                    return json.loads(cached)
                candidate = secrets.token_hex(16)
                if await _redis().set(lock_key, candidate, nx=True, px=10000):
                    lock_token = candidate
                    break
            except Exception:
                use_redis = False
                _redis_retry_at = time.monotonic() + 1
                break
            if time.monotonic() >= deadline:
                # Do not turn an expensive build into one build per TV.
                raise HTTPException(503, 'Display update is being prepared', headers={'Retry-After': '1'})
            await asyncio.sleep(.05)
        if not use_redis:
            cached = _local.get(scope)
            if cached and cached[0] > time.monotonic():
                DISPLAY_SNAPSHOT_HITS.labels('local').inc()
                return copy.deepcopy(cached[1])
        build_generation = getattr(lock, 'snapshot_generation', 0)
        control_version = None
        try:
            if use_redis:
                try:
                    control_version = await _redis().get(_version_key(activity.id) + ':control')
                except Exception:
                    use_redis = False
            DISPLAY_SNAPSHOT_BUILDS.inc()
            payload = _safe_payload(await build())
            if use_redis:
                try:
                    current_control = await _redis().get(_version_key(activity.id) + ':control')
                    if current_control != control_version:
                        raise HTTPException(503, 'Display changed while loading; retry', headers={'Retry-After': '1'})
                    # Store and version check are atomic. An invalidation while
                    # aggregation was running must win over this older result.
                    await _redis().eval(
                        "if (redis.call('get', KEYS[1]) or '0') == ARGV[1] then return redis.call('set', KEYS[2], ARGV[2], 'PX', ARGV[3]) else return 0 end",
                        2, _version_key(activity.id), cache_key, version,
                        json.dumps(payload), settings.display_snapshot_ttl_ms,
                    )
                except HTTPException:
                    raise
                except Exception:
                    _redis_retry_at = time.monotonic() + 1
                    if build_generation == getattr(lock, 'snapshot_generation', 0):
                        _remember(scope, payload)
            elif build_generation == getattr(lock, 'snapshot_generation', 0):
                _remember(scope, payload)
            else:
                raise HTTPException(503, 'Display changed while loading; retry', headers={'Retry-After': '1'})
            return copy.deepcopy(payload)
        finally:
            if lock_token:
                try:
                    await _redis().eval(
                        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
                        1, lock_key, lock_token,
                    )
                except Exception:
                    pass
