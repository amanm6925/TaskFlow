from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from .settings import settings


def _asyncify(url: str) -> str:
    # SQLAlchemy's async engine needs the driver spelled out. Accept the same
    # plain postgresql:// URL that Node/Prisma uses and translate.
    # Also strip Prisma's `?schema=public` query param — asyncpg rejects it.
    if "?" in url:
        url = url.split("?", 1)[0]
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return "postgresql+asyncpg://" + url[len("postgresql://") :]
    if url.startswith("postgres://"):
        return "postgresql+asyncpg://" + url[len("postgres://") :]
    raise ValueError(f"unsupported DATABASE_URL scheme: {url!r}")


engine = create_async_engine(
    _asyncify(settings.DATABASE_URL_APP),
    # NullPool: each transaction opens a fresh connection. Sidesteps asyncpg's
    # event-loop-bound connection state (matters in tests, harmless in prod at
    # Tier 2 scale). Revisit if analytics becomes a hot path.
    poolclass=NullPool,
    connect_args={"server_settings": {"application_name": "taskflow-analytics"}},
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@asynccontextmanager
async def with_tenant(user_id: str) -> AsyncIterator[AsyncSession]:
    """
    Open a transaction-scoped session bound to the given user. RLS policies
    on the Node/Prisma side read `app.current_user_id` to filter rows.

    The set_config(..., true) third argument is Postgres's function-form of
    SET LOCAL — the setting is reset automatically when the transaction ends.
    """
    async with SessionLocal() as session:
        async with session.begin():
            await session.execute(
                text("SELECT set_config('app.current_user_id', :user_id, true)"),
                {"user_id": user_id},
            )
            yield session
