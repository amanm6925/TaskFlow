"""
Test bootstrap:
  1. Spin up a Postgres container.
  2. Set env vars the app needs (before app modules import).
  3. Apply the Prisma schema by shelling out to `npx prisma migrate deploy`
     against the container. Core-api owns the schema; analytics is a consumer.
  4. Expose two SQLAlchemy engines:
     - admin_engine: superuser in the container, bypasses RLS (for seeding).
     - The production with_tenant(user_id) context from app.db still goes through
       the restricted taskflow_app role, so RLS applies in the endpoint path.
"""
from __future__ import annotations

import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine


def _ensure_docker_host() -> None:
    # Mirror of the Node-side detection: macOS Colima users don't have DOCKER_HOST set.
    if os.environ.get("DOCKER_HOST"):
        return
    home = os.path.expanduser("~")
    for candidate in (
        f"{home}/.colima/default/docker.sock",
        f"{home}/.docker/run/docker.sock",
        "/var/run/docker.sock",
    ):
        if os.path.exists(candidate):
            os.environ["DOCKER_HOST"] = f"unix://{candidate}"
            return


_ensure_docker_host()
os.environ.setdefault("TESTCONTAINERS_RYUK_DISABLED", "true")

from testcontainers.postgres import PostgresContainer  # noqa: E402

INTERNAL_SECRET = "test_internal_service_secret_value_123"
CORE_API_DIR = Path(__file__).resolve().parents[2] / "core-api"


@pytest.fixture(scope="session")
def postgres_container():
    container = PostgresContainer("postgres:16-alpine", username="tf_test", password="tf_test", dbname="tf_test")
    container.start()
    yield container
    container.stop()


@pytest.fixture(scope="session", autouse=True)
def configure_environment(postgres_container) -> None:
    host = postgres_container.get_container_host_ip()
    port = postgres_container.get_exposed_port(5432)
    db = postgres_container.dbname
    admin_user = postgres_container.username
    admin_pw = postgres_container.password

    admin_url = f"postgresql://{admin_user}:{admin_pw}@{host}:{port}/{db}"
    app_url = f"postgresql://taskflow_app:taskflow_app_pw@{host}:{port}/{db}"

    # The app reads these at module import; set them before importing app.*
    os.environ["DATABASE_URL_APP"] = app_url
    os.environ["INTERNAL_SERVICE_SECRET"] = INTERNAL_SECRET
    os.environ["ADMIN_DATABASE_URL"] = admin_url

    # Apply the Prisma-owned schema to the new container.
    subprocess.run(
        ["npx", "prisma", "migrate", "deploy"],
        cwd=CORE_API_DIR,
        env={**os.environ, "DATABASE_URL": admin_url},
        check=True,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )


@pytest_asyncio.fixture(scope="session")
async def admin_engine() -> AsyncIterator[AsyncEngine]:
    """Superuser engine for test fixtures — bypasses RLS, lets us seed data."""
    url = os.environ["ADMIN_DATABASE_URL"]
    async_url = "postgresql+asyncpg://" + url[len("postgresql://") :]
    engine = create_async_engine(async_url)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(autouse=True)
async def reset_tables(admin_engine: AsyncEngine):
    """Truncate between tests — fast clean slate, shared container."""
    async with admin_engine.begin() as conn:
        await conn.execute(
            text(
                'TRUNCATE TABLE "refresh_tokens", "tasks", "projects", '
                '"memberships", "organizations", "users" '
                "RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest_asyncio.fixture
async def seed(admin_engine: AsyncEngine):
    """Factory for seeding a user + org + membership + project + task graph."""
    created: list[dict] = []

    async def _seed(
        *,
        user_name: str = "Seed User",
        org_name: str = "Seed Org",
        role: str = "OWNER",
    ) -> dict:
        user_id = str(uuid.uuid4())
        org_id = str(uuid.uuid4())
        project_id = str(uuid.uuid4())
        async with admin_engine.begin() as conn:
            await conn.execute(
                text(
                    'INSERT INTO "users" (id, email, password_hash, name, updated_at) '
                    "VALUES (:id, :email, :ph, :name, NOW())"
                ),
                {"id": user_id, "email": f"{user_id}@t.local", "ph": "x", "name": user_name},
            )
            await conn.execute(
                text(
                    'INSERT INTO "organizations" (id, name, slug, updated_at) '
                    "VALUES (:id, :name, :slug, NOW())"
                ),
                {"id": org_id, "name": org_name, "slug": f"slug-{org_id[:8]}"},
            )
            await conn.execute(
                text(
                    'INSERT INTO "memberships" (id, user_id, organization_id, role) '
                    'VALUES (:id, :uid, :oid, CAST(:role AS "Role"))'
                ),
                {"id": str(uuid.uuid4()), "uid": user_id, "oid": org_id, "role": role},
            )
            await conn.execute(
                text(
                    'INSERT INTO "projects" (id, organization_id, name, key, created_by_id, updated_at) '
                    "VALUES (:id, :oid, :name, :key, :uid, NOW())"
                ),
                {"id": project_id, "oid": org_id, "name": "Seed Project", "key": "SP", "uid": user_id},
            )
            await conn.execute(
                text(
                    'INSERT INTO "tasks" (id, project_id, number, title, reporter_id, updated_at) '
                    "VALUES (:id, :pid, 1, :title, :uid, NOW())"
                ),
                {"id": str(uuid.uuid4()), "pid": project_id, "title": "Seed Task", "uid": user_id},
            )
        ctx = {"user_id": user_id, "org_id": org_id, "project_id": project_id}
        created.append(ctx)
        return ctx

    yield _seed


@pytest_asyncio.fixture
async def client() -> AsyncIterator:
    # Deferred import: settings validate env at module load time.
    from httpx import ASGITransport, AsyncClient

    from app.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def auth_headers(user_id: str) -> dict[str, str]:
    return {"X-Internal-Auth": INTERNAL_SECRET, "X-User-Id": user_id}
