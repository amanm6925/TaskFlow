import hmac
from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status

from .settings import settings


async def verify_internal(
    x_internal_auth: Annotated[str | None, Header(alias="X-Internal-Auth")] = None,
    x_user_id: Annotated[str | None, Header(alias="X-User-Id")] = None,
) -> str:
    """
    Validate a service-to-service call and extract the caller's user-id context.

    Returns the user_id. Reject with 401 if the shared secret is missing/wrong,
    400 if the user header is missing or malformed.

    Uses constant-time comparison so the secret can't be discovered via timing.
    """
    if x_internal_auth is None or not hmac.compare_digest(
        x_internal_auth, settings.INTERNAL_SERVICE_SECRET
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_internal_auth")

    if not x_user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "x_user_id_required")

    try:
        UUID(x_user_id)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "x_user_id_invalid")

    return x_user_id


InternalUserId = Annotated[str, Depends(verify_internal)]
