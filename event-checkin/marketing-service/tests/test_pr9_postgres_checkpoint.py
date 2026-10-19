"""Opt-in only: dedicated disposable PostgreSQL container, never a live DB."""
import asyncio
import os
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects import postgresql
from app.retention import RetentionJob,migrate_checkpoint


@pytest.mark.skipif(not os.getenv("TASK_POSTGRES_TEST_URL"),reason="Dedicated disposable PostgreSQL runtime only")
def test_postgres_existing_integer_migrates_and_round_trips_48_bit_identity():
    url=make_url(os.environ["TASK_POSTGRES_TEST_URL"])
    assert url.host=="127.0.0.1" and url.database=="journey_review" and url.username=="synthetic"
    async def execute():
        engine=create_async_engine(url)
        old=str(CreateTable(RetentionJob.__table__).compile(dialect=postgresql.dialect())).replace("step BIGINT","step INTEGER")
        async with engine.begin() as connection:
            await connection.execute(text(old))
            await connection.execute(text("INSERT INTO marketing_organizer_retention_jobs (id,lead_id,event_id,org_id,step,sequence_id,status) VALUES ('old','lead','event','org',2147483647,'preserved','pending')"))
        async with engine.connect() as connection:
            await connection.run_sync(lambda sync:migrate_checkpoint(sync.engine))
        async with engine.begin() as connection:
            await connection.execute(text("INSERT INTO marketing_organizer_retention_jobs (id,lead_id,event_id,org_id,step,sequence_id,status) VALUES ('wide','lead','event2','org',281474976710655,'preserved','pending')"))
            rows=(await connection.execute(text("SELECT id,step,sequence_id FROM marketing_organizer_retention_jobs ORDER BY id"))).all()
            assert rows==[('old',2147483647,'preserved'),('wide',281474976710655,'preserved')]
            assert (await connection.execute(text("SELECT data_type FROM information_schema.columns WHERE table_name='marketing_organizer_retention_jobs' AND column_name='step'"))).scalar_one()=="bigint"
        async with engine.connect() as connection:
            await connection.run_sync(lambda sync:migrate_checkpoint(sync.engine))
        await engine.dispose()
    asyncio.run(execute())

@pytest.mark.parametrize("channel",["chat","whatsapp"])
@pytest.mark.parametrize("provider_receipt",[False,True])
@pytest.mark.skipif(not os.getenv("TASK_POSTGRES_TEST_URL"),reason="Dedicated disposable PostgreSQL runtime only")
def test_postgres_submission_row_lock_fences_reconciliation_after_final_check(monkeypatch,channel,provider_receipt):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from types import SimpleNamespace
    import httpx
    from sqlalchemy.orm import Session
    from sqlalchemy.exc import DBAPIError
    from app import sales_responses as sales,journey_workers as workers
    from test_journey_workers import real_sales_fixture
    url=make_url(os.environ["TASK_POSTGRES_TEST_URL"])
    assert url.host=="127.0.0.1" and url.database=="journey_review" and url.username=="synthetic"
    body=real_sales_fixture(monkeypatch,channel);local=threading.local()
    async def execute(callback):
        engine=create_async_engine(url)
        try:
            from sqlalchemy.ext.asyncio import AsyncSession
            async with AsyncSession(engine,expire_on_commit=False) as session:
                def call(sync):
                    local.factory=lambda:Session(engine.sync_engine,expire_on_commit=False)
                    return callback(sync)
                return await session.run_sync(call)
        finally:await engine.dispose()
    def run(callback):return asyncio.run(execute(callback))
    async def schema(create):
        engine=create_async_engine(url)
        try:
            async with engine.begin() as connection:
                await connection.run_sync(sales.Base.metadata.create_all if create else sales.Base.metadata.drop_all)
        finally:await engine.dispose()
    asyncio.run(schema(True))
    m=SimpleNamespace(SessionLocal=lambda:local.factory())
    def prepare(db):
        first=sales.ingest(db,body)
        second=sales.ingest(db,{**body,"event_id":"pg-second"})
        return first.id,second.id,first.conversation_id
    one,two,key=run(prepare)
    entered=threading.Event();release=threading.Event();requests=[];post=httpx.Client.post
    def before_transport(client,*args,**kwargs):
        entered.set();assert release.wait(10)
        return post(client,*args,**kwargs)
    monkeypatch.setattr(httpx.Client,"post",before_transport)
    adapter=workers.SalesAdapter(m,transport=httpx.MockTransport(lambda request:(requests.append(request) or httpx.Response(200,json={"id":"synthetic-pg-accepted"}))))
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            old=pool.submit(run,lambda db:sales.dispatch(db,one,adapter));assert entered.wait(10)
            try:
                def competing(db):
                    # PostgreSQL permits stale-recovery writes to Reply while
                    # the provider boundary holds the separate Guard row.
                    db.get(sales.Reply,one).status="unknown";sales.hold_conversation(db,key);db.commit()
                    db.execute(text("SET LOCAL lock_timeout = '100ms'"))
                    with pytest.raises(DBAPIError) as blocked:
                        sales.reconcile(db,one,**({"provider_id":"authenticated-receipt"} if provider_receipt else {"definitely_not_sent":True}))
                    assert getattr(blocked.value.orig,"sqlstate",None)=="55P03"
                    db.rollback()
                    assert db.get(sales.DispatchGuard,key).active_reply==one
                    assert sales.dispatch(db,two,adapter)=="reconciliation_required"
                run(competing);assert requests==[]
            finally:release.set()
            assert old.result(timeout=10)=="reconciliation_required"
        assert len(requests)==1
        def verified(db):
            assert sales.reconcile(db,one,provider_id="synthetic-pg-accepted")=="accepted"
            assert db.get(sales.DispatchGuard,key).active_reply is None
            assert db.get(sales.Conversation,key).status=="paused"
        run(verified)
    finally:asyncio.run(schema(False))
