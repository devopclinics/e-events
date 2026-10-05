import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from app.auth import Identity
from app.routers import activities, qna
from app.schemas import QnaSubmitIn

NOW = datetime(2026, 10, 5, tzinfo=timezone.utc)


def question(id, sequence, correct=False):
    return SimpleNamespace(id=id, sequence=sequence, status='active', options=[SimpleNamespace(is_correct=correct)], live_state='pending', config={}, time_limit_seconds=None)


def activity(type='quiz', phase='intro', questions=None, current=None):
    return SimpleNamespace(id='activity-a', event_id='event-a', org_id='org-a', session_id=None, type=type, status='live', questions=questions or [], config={'show_mode':'guided','show_phase':phase,'current_question_id':current,'show_automation_enabled':True,'leaderboard_enabled':type=='quiz'})


class GuidedNavigationTests(unittest.TestCase):
    def test_walk_back_across_questions_and_forward_again_without_removing_answers(self):
        first, second = question('q1',1,True), question('q2',2)
        show = activity(questions=[first,second]); show.saved_responses=['answer-a','answer-b']
        visited=[(show.config['show_phase'],None)]
        while show.config['show_phase']!='complete':
            activities._apply_guided_advance(show,NOW)
            visited.append((show.config['show_phase'],show.config['current_question_id']))
        for expected in reversed(visited[:-1]):
            activities._apply_guided_previous(show,NOW)
            self.assertEqual((show.config['show_phase'],show.config['current_question_id']),expected)
            self.assertEqual(show.saved_responses,['answer-a','answer-b'])
            self.assertFalse(show.config['show_automation_enabled'])
            self.assertIsNone(show.config['show_phase_deadline_at'])
            self.assertLessEqual(sum(q.live_state=='open' for q in show.questions),1)
        self.assertEqual(show.status,'live')
        activities._apply_guided_previous(show,NOW)
        self.assertEqual(show.config['show_phase'],'lobby')
        with self.assertRaises(HTTPException): activities._apply_guided_previous(show,NOW)

    def test_existing_show_without_history_can_go_back_and_reopen_voting(self):
        q=question('q1',1);show=activity(type='poll',phase='locked',questions=[q],current='q1')
        phase,current=activities._apply_guided_previous(show,NOW)
        self.assertEqual(phase,'answering');self.assertEqual(current.live_state,'open')
        self.assertEqual(current.config['opened_at'],NOW.isoformat())

    def test_qna_and_forms_go_back_without_needing_configured_questions(self):
        for kind,phases in [('q_and_a',['results','answering','intro','lobby']),('survey',['results','locked','answering','intro','lobby']),('feedback',['results','locked','answering','intro','lobby'])]:
            show=activity(type=kind,phase='complete');show.status='closed'
            for phase in phases:
                actual,_=activities._apply_guided_previous(show,NOW);self.assertEqual(actual,phase)

    def test_inactive_question_is_not_a_previous_target(self):
        inactive=question('q0',0);inactive.status='archived'
        q=question('q1',1);show=activity(phase='question_preview',questions=[inactive,q],current='q1')
        self.assertEqual(activities._guided_previous_target(show),('intro',None))

    def test_advance_endpoint_publishes_persisted_phase_and_question_after_commit(self):
        q=question('q1',1);show=activity(phase='question_preview',questions=[q],current='q1')
        db=SimpleNamespace(commit=AsyncMock())
        identity=Identity('staff','presenter-a','event-a','org-a','presenter',('control',))
        with patch.object(activities,'_get_owned_activity',new=AsyncMock(return_value=show)), patch.object(activities,'_fetch_activity',new=AsyncMock(return_value=show)), patch.object(activities,'publish',new=AsyncMock()) as publish:
            result=asyncio.run(activities.advance_guided_show(show.id,identity,db))
        self.assertIs(result,show);db.commit.assert_awaited_once()
        self.assertEqual(publish.await_args_list[0].args,('activity-a','show.phase_changed',{'phase':'answering','question_id':'q1'}))

    def test_previous_endpoint_allows_presenter_and_denies_moderator(self):
        show=activity(type='q_and_a',phase='results');db=SimpleNamespace(commit=AsyncMock())
        presenter=Identity('staff','presenter-a','event-a','org-a','presenter',('control',))
        with patch.object(activities,'_get_owned_activity',new=AsyncMock(return_value=show)), patch.object(activities,'_fetch_activity',new=AsyncMock(return_value=show)), patch.object(activities,'publish',new=AsyncMock()) as publish:
            asyncio.run(activities.previous_guided_show(show.id,presenter,db))
        self.assertEqual(show.config['show_phase'],'answering');db.commit.assert_awaited_once()
        self.assertEqual(publish.await_args_list[0].args[1],'show.phase_changed')
        moderator=Identity('staff','moderator-a','event-a','org-a','moderator',('moderate',))
        with self.assertRaises(HTTPException) as error: asyncio.run(activities.previous_guided_show(show.id,moderator,db))
        self.assertEqual(error.exception.status_code,403)

    def test_previous_rejects_completed_and_manually_closed_activities(self):
        for status,phase in [('completed','complete'),('closed','answering')]:
            show=activity(type='q_and_a',phase=phase);show.status=status;db=SimpleNamespace(commit=AsyncMock())
            with patch.object(activities,'_get_owned_activity',new=AsyncMock(return_value=show)), self.assertRaises(HTTPException):
                asyncio.run(activities.previous_guided_show(show.id,Identity('staff','owner','event-a','org-a','owner'),db))
            db.commit.assert_not_awaited()


class RepeatedQnaTests(unittest.TestCase):
    def test_same_guest_can_submit_multiple_questions_during_answering_and_display(self):
        for phase in ('answering','results'):
            show=activity(type='q_and_a',phase=phase);saved=[]
            async def refresh(row):
                row.id=f'qna-{len(saved)}';row.status='pending';row.upvote_count=0;row.created_at=NOW
            db=SimpleNamespace(add=lambda row:saved.append(row),commit=AsyncMock(),refresh=refresh)
            guest=Identity('guest','guest-a','event-a','org-a','guest')
            with patch.object(qna,'_fetch_activity',new=AsyncMock(return_value=show)), patch.object(qna,'_get_or_create_participant',new=AsyncMock(return_value=SimpleNamespace(id='participant-a'))), patch.object(qna,'enforce_rate_limit',new=AsyncMock()), patch.object(qna,'publish',new=AsyncMock()):
                for text in ('First question?','Second question?','Third question?'):
                    result=asyncio.run(qna.submit_qna(show.id,QnaSubmitIn(text=text),None,guest,db))
                    self.assertTrue(result.is_mine);self.assertEqual(result.status,'pending')
            self.assertEqual(len(saved),3);self.assertEqual(len(set(row.id for row in saved)),3)
            self.assertEqual(db.commit.await_count,3)

    def test_qna_does_not_accept_questions_in_lobby_or_after_closing(self):
        for phase,status in [('lobby','live'),('intro','live'),('complete','closed')]:
            show=activity(type='q_and_a',phase=phase);show.status=status;db=SimpleNamespace(commit=AsyncMock())
            with patch.object(qna,'_fetch_activity',new=AsyncMock(return_value=show)), patch.object(qna,'enforce_rate_limit',new=AsyncMock()), self.assertRaises(HTTPException):
                asyncio.run(qna.submit_qna(show.id,QnaSubmitIn(text='Question?'),None,Identity('guest','guest-a','event-a','org-a','guest'),db))
            db.commit.assert_not_awaited()
