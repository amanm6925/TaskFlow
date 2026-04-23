from fastapi import FastAPI
from .reports import router as reports_router

app = FastAPI(title="TaskFlow Analytics", version="0.1.0")


@app.get("/health")
async def health():
    return {"ok": True}


app.include_router(reports_router, prefix="/internal")
