"""AI Data Analyst API: CSV upload + natural-language analytics."""

from __future__ import annotations

import io
import uuid
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from query_engine import run_query

app = FastAPI(title="AI Data Analyst", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# session_id -> DataFrame
STORE: dict[str, pd.DataFrame] = {}


class QueryBody(BaseModel):
    question: str
    session_id: str


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Please upload a .csv file")
    raw = await file.read()
    try:
        df = pd.read_csv(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(400, f"Could not parse CSV: {e}") from e

    if df.empty or len(df.columns) == 0:
        raise HTTPException(400, "CSV has no rows or columns")

    session_id = str(uuid.uuid4())
    STORE[session_id] = df
    return {
        "session_id": session_id,
        "filename": file.filename,
        "rows": len(df),
        "columns": list(df.columns),
        "preview": df.head(10).fillna("").to_dict(orient="records"),
    }


@app.post("/api/query")
def query(body: QueryBody) -> dict[str, Any]:
    sid = body.session_id.strip()
    if sid not in STORE:
        raise HTTPException(404, "Session not found. Upload a CSV first.")
    df = STORE[sid]
    q = body.question.strip()
    if not q:
        raise HTTPException(400, "Question is required")

    result = run_query(df, q, use_llm=True)
    return {
        "question": q,
        "insight": result.get("insight"),
        "chart": result.get("chart"),
        "table": result.get("table"),
        "used_llm": result.get("used_llm"),
        "plan": result.get("plan"),
    }


@app.delete("/api/session/{session_id}")
def delete_session(session_id: str) -> dict[str, str]:
    STORE.pop(session_id, None)
    return {"ok": "true"}
