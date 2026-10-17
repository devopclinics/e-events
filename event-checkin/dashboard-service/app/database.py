from sqlalchemy.engine import URL
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from .config import settings

engine = create_async_engine(
    URL.create(
        drivername="postgresql+asyncpg",
        host=settings.dashboard_db_host,
        port=settings.dashboard_db_port,
        database=settings.dashboard_db_name,
        username=settings.dashboard_db_user,
        password=settings.dashboard_ro_db_password.get_secret_value(),
    ),
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,
    pool_size=10,
    max_overflow=5,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
