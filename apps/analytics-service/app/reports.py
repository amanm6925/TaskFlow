import csv
import io
from uuid import UUID

from fastapi import APIRouter, HTTPException, Path, status
from fastapi.responses import StreamingResponse
from sqlalchemy import text

from .db import with_tenant
from .internal_auth import InternalUserId

router = APIRouter()


@router.get("/reports/projects/{project_id}/tasks.csv")
async def tasks_csv(
    user_id: InternalUserId,
    project_id: str = Path(..., description="Project UUID"),
):
    # Validate path param shape before hitting the DB.
    try:
        UUID(project_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "project_id_invalid")

    async with with_tenant(user_id) as session:
        # RLS scopes both the project lookup and the task query to the user's orgs.
        project_row = (
            await session.execute(
                text(
                    """
                    SELECT id, organization_id, name, key
                    FROM projects
                    WHERE id = :pid
                    """
                ),
                {"pid": project_id},
            )
        ).first()

        # If RLS filtered it, row is None — same shape as "project genuinely does not exist".
        if project_row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "project_not_found")

        tasks = await session.execute(
            text(
                """
                SELECT
                    t.number,
                    t.title,
                    t.status,
                    t.priority,
                    t.due_date,
                    reporter.name AS reporter_name,
                    assignee.name AS assignee_name,
                    t.created_at,
                    t.updated_at
                FROM tasks t
                JOIN users reporter ON reporter.id = t.reporter_id
                LEFT JOIN users assignee ON assignee.id = t.assignee_id
                WHERE t.project_id = :pid
                ORDER BY t.number ASC
                """
            ),
            {"pid": project_id},
        )

        # Materialize eagerly — small-to-medium datasets; adjust to streaming if needed.
        rows = tasks.all()

    def generate():
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([
            "key", "title", "status", "priority", "due_date",
            "reporter", "assignee", "created_at", "updated_at",
        ])
        yield buf.getvalue()
        buf.seek(0); buf.truncate(0)

        for row in rows:
            writer.writerow([
                f"{project_row.key}-{row.number}",
                row.title,
                row.status,
                row.priority,
                row.due_date.isoformat() if row.due_date else "",
                row.reporter_name,
                row.assignee_name or "",
                row.created_at.isoformat(),
                row.updated_at.isoformat(),
            ])
            yield buf.getvalue()
            buf.seek(0); buf.truncate(0)

    filename = f"{project_row.key}-tasks.csv"
    return StreamingResponse(
        generate(),
        media_type="text/csv; charset=utf-8",
        headers={"content-disposition": f'attachment; filename="{filename}"'},
    )
