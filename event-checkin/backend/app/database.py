from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from .config import settings

# pool_pre_ping recycles dead connections before use (Postgres/network drops a
# long-idle connection otherwise -> "connection is closed" 500s over long uptime).
# pool_recycle proactively retires connections before the server's idle timeout.
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=20,
    max_overflow=10,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
