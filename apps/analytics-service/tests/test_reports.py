import pytest

from .conftest import INTERNAL_SECRET, auth_headers

# Run every test in the same session-scoped event loop as the session-scoped
# fixtures (engine, container). Avoids asyncpg's "Future attached to a
# different loop" error from pooled connections being reused across loops.
pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_health(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


class TestInternalAuth:
    async def test_missing_secret_returns_401(self, client):
        response = await client.get(
            "/internal/reports/projects/019db9e1-e75d-7b20-b295-cf6de84aa77c/tasks.csv",
            headers={"X-User-Id": "019db9e1-e75d-7b20-b295-cf6de84aa77c"},
        )
        assert response.status_code == 401

    async def test_wrong_secret_returns_401(self, client):
        response = await client.get(
            "/internal/reports/projects/019db9e1-e75d-7b20-b295-cf6de84aa77c/tasks.csv",
            headers={
                "X-Internal-Auth": "not-the-real-secret",
                "X-User-Id": "019db9e1-e75d-7b20-b295-cf6de84aa77c",
            },
        )
        assert response.status_code == 401

    async def test_missing_user_id_returns_400(self, client):
        response = await client.get(
            "/internal/reports/projects/019db9e1-e75d-7b20-b295-cf6de84aa77c/tasks.csv",
            headers={"X-Internal-Auth": INTERNAL_SECRET},
        )
        assert response.status_code == 400

    async def test_malformed_user_id_returns_400(self, client):
        response = await client.get(
            "/internal/reports/projects/019db9e1-e75d-7b20-b295-cf6de84aa77c/tasks.csv",
            headers={"X-Internal-Auth": INTERNAL_SECRET, "X-User-Id": "not-a-uuid"},
        )
        assert response.status_code == 400


class TestTasksCsv:
    async def test_member_of_org_gets_csv(self, client, seed):
        ctx = await seed()
        response = await client.get(
            f"/internal/reports/projects/{ctx['project_id']}/tasks.csv",
            headers=auth_headers(ctx["user_id"]),
        )
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        body = response.text
        lines = body.strip().splitlines()
        assert lines[0] == "key,title,status,priority,due_date,reporter,assignee,created_at,updated_at"
        assert len(lines) == 2
        assert "Seed Task" in lines[1]
        assert lines[1].startswith("SP-1,")

    async def test_non_member_returns_404_rls_filters_project(self, client, seed):
        owner = await seed(user_name="Owner")
        # Another user with no membership in the owner's org.
        outsider = await seed(user_name="Outsider")
        response = await client.get(
            f"/internal/reports/projects/{owner['project_id']}/tasks.csv",
            headers=auth_headers(outsider["user_id"]),
        )
        # RLS filters the SELECT on projects → no rows → handler returns 404.
        assert response.status_code == 404
        assert response.json() == {"detail": "project_not_found"}

    async def test_invalid_project_id_returns_400(self, client, seed):
        ctx = await seed()
        response = await client.get(
            "/internal/reports/projects/not-a-uuid/tasks.csv",
            headers=auth_headers(ctx["user_id"]),
        )
        assert response.status_code == 400

    async def test_unknown_project_id_returns_404(self, client, seed):
        ctx = await seed()
        response = await client.get(
            "/internal/reports/projects/019db9e1-e75d-7b20-b295-cf6de84aa77c/tasks.csv",
            headers=auth_headers(ctx["user_id"]),
        )
        assert response.status_code == 404
