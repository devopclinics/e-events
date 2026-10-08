import asyncio
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock
from app.auth import Identity
from app.routers.activities import list_activities, list_control_activities

def result(rows):
    return SimpleNamespace(all=lambda:rows,scalars=lambda:SimpleNamespace(all=lambda:rows))

def activity(id,kind):
    return SimpleNamespace(id=id,type=kind,title=id,status='live',session_id=None,created_at=datetime(2026,10,7),config={})

def test_activity_counts_distinguish_questions_and_responses_without_per_activity_queries():
    identity=Identity(identity_kind='staff',subject='owner',event_id='event',org_id='org',role='owner')
    rows=[activity('qna','q_and_a'),activity('quiz','quiz')]
    db=SimpleNamespace(execute=AsyncMock(side_effect=[result(rows),result([('quiz',3)]),result([('qna',1),('quiz',2)]),result([]),result([('qna',1)])]))
    summaries=asyncio.run(list_activities(identity,db))
    assert summaries[0].participant_count==1 and summaries[0].question_count==1 and summaries[0].response_count==0
    assert summaries[1].response_count==3 and summaries[1].question_count==0
    assert db.execute.await_count==5
    sql=str(db.execute.call_args_list[0].args[0].compile(compile_kwargs={'literal_binds':True}))
    assert "event_id = 'event'" in sql and "org_id = 'org'" in sql

def test_presenter_control_counts_include_qna_questions():
    identity=Identity(identity_kind='staff',subject='owner',event_id='event',org_id='org',role='owner')
    db=SimpleNamespace(execute=AsyncMock(side_effect=[result([activity('qna','q_and_a')]),result([]),result([('qna',1)]),result([('qna',2)])]))
    summary=asyncio.run(list_control_activities(identity,db))[0]
    assert summary.question_count==2 and summary.participant_count==1 and summary.response_count==0

def test_session_picker_excludes_archived_but_history_is_explicitly_available():
    from app.routers.program_sync import list_program_sessions
    identity=Identity(identity_kind='staff',subject='owner',event_id='event',org_id='org',role='owner')
    for include_archived in (False,True):
        db=SimpleNamespace(execute=AsyncMock(return_value=result([])))
        assert asyncio.run(list_program_sessions(identity,db,include_archived))==[]
        sql=str(db.execute.call_args.args[0].compile(compile_kwargs={'literal_binds':True}))
        assert "event_id = 'event'" in sql and "org_id = 'org'" in sql
        assert ("status IN ('published', 'draft')" in sql) is (not include_archived)
