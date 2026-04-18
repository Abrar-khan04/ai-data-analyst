"""Google Gemini helper: natural language → structured query JSON."""

from __future__ import annotations

import json
import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()


SCHEMA_HINT = """
Return ONLY valid JSON (no markdown, no code blocks) with this shape:
{
  "insight_hint": "one short sentence describing what the user will see",
  "operation": {
    "kind": "top_n" | "group_agg" | "time_series" | "scalar" | "value_counts",
    "params": {
      "n": 5,
      "group_col": "column name or null",
      "value_col": "numeric column name or null",
      "agg": "sum" | "mean" | "count" | "max" | "min",
      "date_col": "datetime column name or null",
      "freq": "ME" | "W" | "D",
      "category_col": "for pie/value_counts"
    }
  }
}

Rules:
- Use exact column names from the schema (case-sensitive).
- For "top N by X", use kind "top_n" with value_col=X, n=N, group_col=the label column (e.g. product name).
- For "trend over time" / "monthly", use kind "time_series" with date_col, value_col, freq "ME".
- For "average X" / "total X", use kind "scalar" with agg mean/sum and value_col.
- For "sales by region", use kind "group_agg" with group_col=region, value_col=sales, agg=sum.
- For "distribution" / "share" / pie, use kind "value_counts" or group_agg with one category and one value.
"""


def nl_to_operation_via_llm(
    question: str,
    columns: list[str],
    dtypes: dict[str, str],
    sample_csv: str,
) -> dict[str, Any] | None:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        import google.generativeai as genai
    except ImportError:
        return None

    genai.configure(api_key=api_key)

    model_name = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    model = genai.GenerativeModel(
        model_name=model_name,
        generation_config={
            "temperature": 0.1,
            "response_mime_type": "application/json",
        },
        system_instruction="You are a careful analytics assistant. Output only valid JSON, no code blocks, no markdown.",
    )

    user_content = f"""Dataset columns and types:
{json.dumps(dtypes, indent=2)}

Column names: {columns}

First rows (CSV):
{sample_csv}

User question: {question}

{SCHEMA_HINT}
"""

    try:
        resp = model.generate_content(user_content)
        raw = resp.text or "{}"
        # Strip any accidental markdown code fences
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

        return json.loads(raw)
    except Exception as e:
        print(f"Gemini API Error: {e}")
        return None
