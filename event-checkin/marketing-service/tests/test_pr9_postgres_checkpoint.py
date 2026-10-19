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
