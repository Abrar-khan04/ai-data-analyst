"""Heuristic NL → operation, pandas execution, chart-friendly output."""

from __future__ import annotations

import re
from typing import Any

import pandas as pd

from llm_client import nl_to_operation_via_llm


def _dtype_map(df: pd.DataFrame) -> dict[str, str]:
    out: dict[str, str] = {}
    for c in df.columns:
        s = df[c]
        if pd.api.types.is_datetime64_any_dtype(s):
            out[c] = "datetime"
        elif pd.api.types.is_numeric_dtype(s):
            out[c] = "number"
        else:
            out[c] = "string"
    return out


def _guess_date_col(df: pd.DataFrame) -> str | None:
    for c in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[c]):
            return c
        if df[c].dtype == object:
            try:
                pd.to_datetime(df[c].dropna().head(20))
                return c
            except Exception:
                continue
    return None


def _numeric_cols(df: pd.DataFrame) -> list[str]:
    return [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]


def _infer_operation_heuristic(question: str, df: pd.DataFrame) -> dict[str, Any]:
    q = question.lower().strip()
    nums = _numeric_cols(df)
    date_c = _guess_date_col(df)
    cols_lower = {c.lower(): c for c in df.columns}

    def pick_col(keywords: list[str], prefer_numeric: bool = False) -> str | None:
        for kw in keywords:
            if kw in cols_lower:
                c = cols_lower[kw]
                if prefer_numeric and c not in nums:
                    continue
                return c
        for c in df.columns:
            cl = c.lower()
            for kw in keywords:
                if kw in cl:
                    if prefer_numeric and c not in nums:
                        continue
                    return c
        return nums[0] if nums else None

    # top N
    m = re.search(r"top\s+(\d+)", q)
    n = int(m.group(1)) if m else 5
    if "top" in q or "highest" in q or "best" in q:
        val = pick_col(["revenue", "sales", "amount", "total", "value", "price"], prefer_numeric=True)
        label = pick_col(["product", "name", "item", "region", "category", "country"], prefer_numeric=False)
        if val and label:
            return {
                "insight_hint": f"Top {n} by {val}",
                "operation": {
                    "kind": "top_n",
                    "params": {"n": n, "group_col": label, "value_col": val},
                },
            }

    # trend / monthly
    if any(k in q for k in ["trend", "over time", "monthly", "weekly", "time series"]):
        vc = pick_col(["revenue", "sales", "amount", "total"], prefer_numeric=True)
        dc = date_c or pick_col(["date", "time", "month", "day"], prefer_numeric=False)
        if dc and vc:
            return {
                "insight_hint": "Trend over time",
                "operation": {
                    "kind": "time_series",
                    "params": {
                        "date_col": dc,
                        "value_col": vc,
                        "freq": "ME",
                    },
                },
            }

    # by region / category → group_agg
    m2 = re.search(r"by\s+(\w+)", q)
    if m2 or " per " in q:
        key = m2.group(1) if m2 else None
        group = None
        if key and key in cols_lower:
            group = cols_lower[key]
        else:
            group = pick_col(["region", "category", "country", "state", "city", "segment"], prefer_numeric=False)
        val = pick_col(["revenue", "sales", "amount", "total"], prefer_numeric=True)
        if group and val:
            return {
                "insight_hint": f"{val} by {group}",
                "operation": {
                    "kind": "group_agg",
                    "params": {
                        "group_col": group,
                        "value_col": val,
                        "agg": "sum",
                    },
                },
            }

    # average / sum scalar
    if "average" in q or "mean" in q:
        vc = pick_col(["order", "value", "amount", "revenue", "sales", "price"], prefer_numeric=True)
        if vc:
            return {
                "insight_hint": f"Average of {vc}",
                "operation": {"kind": "scalar", "params": {"value_col": vc, "agg": "mean"}},
            }
    if "total" in q or "sum" in q:
        vc = pick_col(["revenue", "sales", "amount"], prefer_numeric=True)
        if vc:
            return {
                "insight_hint": f"Total {vc}",
                "operation": {"kind": "scalar", "params": {"value_col": vc, "agg": "sum"}},
            }

    # which X has highest — max by group
    if "which" in q or "highest" in q:
        group = pick_col(["region", "category", "country", "product"], prefer_numeric=False)
        val = pick_col(["revenue", "sales", "amount"], prefer_numeric=True)
        if group and val:
            return {
                "insight_hint": f"Highest {val} by {group}",
                "operation": {
                    "kind": "top_n",
                    "params": {"n": 1, "group_col": group, "value_col": val},
                },
            }

    # default: summary
    return {
        "insight_hint": "Dataset overview",
        "operation": {"kind": "summary", "params": {}},
    }


def _ensure_datetime(df: pd.DataFrame, col: str) -> pd.Series:
    s = df[col]
    if pd.api.types.is_datetime64_any_dtype(s):
        return s
    return pd.to_datetime(s, errors="coerce")


def _execute_operation(df: pd.DataFrame, op: dict[str, Any]) -> dict[str, Any]:
    kind = op.get("kind", "summary")
    p = op.get("params") or {}

    if kind == "summary":
        desc = df.describe(include="all").transpose().head(15)
        text = f"Rows: {len(df)}, Columns: {len(df.columns)}. "
        nums = _numeric_cols(df)
        if nums:
            text += f"Numeric columns: {', '.join(nums)}. "
        return {
            "insight": text + "Key statistics (sample) in table.",
            "chart": None,
            "table": desc.reset_index().rename(columns={"index": "column"}).to_dict(orient="records"),
        }

    if kind == "scalar":
        vc = p.get("value_col")
        agg = p.get("agg", "mean")
        if not vc or vc not in df.columns:
            raise ValueError("Invalid value column for scalar")
        series = df[vc]
        if agg == "mean":
            val = float(series.mean())
            label = "Average"
        elif agg == "sum":
            val = float(series.sum())
            label = "Total"
        else:
            val = float(series.agg(agg))
            label = agg.title()
        return {
            "insight": f"{label} **{vc}**: {val:,.4g}",
            "chart": None,
            "table": [{"metric": label, "column": vc, "value": val}],
        }

    if kind == "top_n":
        n = int(p.get("n", 5))
        group_col = p.get("group_col")
        value_col = p.get("value_col")
        if not group_col or not value_col:
            raise ValueError("top_n requires group_col and value_col")
        sub = df[[group_col, value_col]].dropna()
        g = sub.groupby(group_col, as_index=False)[value_col].sum()
        g = g.sort_values(value_col, ascending=False).head(n)
        chart = {
            "type": "bar",
            "data": g.rename(columns={group_col: "name", value_col: "value"}).to_dict(orient="records"),
            "xKey": "name",
            "dataKeys": ["value"],
        }
        return {
            "insight": f"Top {n} by {value_col} (aggregated with sum per {group_col}).",
            "chart": chart,
            "table": g.to_dict(orient="records"),
        }

    if kind == "group_agg":
        group_col = p.get("group_col")
        value_col = p.get("value_col")
        agg = p.get("agg", "sum")
        if not group_col or not value_col:
            raise ValueError("group_agg requires group_col and value_col")
        sub = df[[group_col, value_col]].dropna()
        g = sub.groupby(group_col, as_index=False)[value_col].agg(agg)
        g = g.sort_values(value_col, ascending=False)
        chart = {
            "type": "bar",
            "data": g.rename(columns={group_col: "name", value_col: "value"}).to_dict(orient="records"),
            "xKey": "name",
            "dataKeys": ["value"],
        }
        return {
            "insight": f"{agg.title()} of {value_col} by {group_col}.",
            "chart": chart,
            "table": g.to_dict(orient="records"),
        }

    if kind == "time_series":
        date_col = p.get("date_col")
        value_col = p.get("value_col")
        freq = p.get("freq", "ME")
        if freq == "M":
            freq = "ME"
        if not date_col or not value_col:
            raise ValueError("time_series requires date_col and value_col")
        t = _ensure_datetime(df, date_col)
        sub = pd.DataFrame({"t": t, "v": df[value_col]}).dropna()
        sub = sub.set_index("t").resample(freq)["v"].sum()
        sub = sub.reset_index()
        sub["name"] = sub["t"].dt.strftime("%Y-%m")
        sub = sub.rename(columns={"v": "value"})
        chart = {
            "type": "line",
            "data": sub[["name", "value"]].to_dict(orient="records"),
            "xKey": "name",
            "dataKeys": ["value"],
        }
        return {
            "insight": f"{value_col} over time ({freq} buckets).",
            "chart": chart,
            "table": sub.to_dict(orient="records"),
        }

    if kind == "value_counts":
        cat = p.get("category_col") or p.get("group_col")
        if not cat or cat not in df.columns:
            raise ValueError("value_counts needs category_col")
        vc = df[cat].value_counts().head(12)
        data = [{"name": str(i), "value": int(v)} for i, v in vc.items()]
        chart = {"type": "pie", "data": data, "xKey": "name", "dataKeys": ["value"]}
        return {
            "insight": f"Distribution of {cat}.",
            "chart": chart,
            "table": data,
        }

    raise ValueError(f"Unknown operation kind: {kind}")


def run_query(df: pd.DataFrame, question: str, use_llm: bool = True) -> dict[str, Any]:
    dtypes = _dtype_map(df)
    sample = df.head(8).to_csv(index=False)
    plan: dict[str, Any] | None = None
    used_llm = False

    if use_llm:
        plan = nl_to_operation_via_llm(
            question,
            list(df.columns),
            dtypes,
            sample,
        )
        used_llm = plan is not None and "operation" in plan

    if not plan or "operation" not in plan:
        plan = _infer_operation_heuristic(question, df)
        used_llm = False

    try:
        result = _execute_operation(df, plan["operation"])
    except Exception as e:
        if use_llm:
            plan = _infer_operation_heuristic(question, df)
            used_llm = False
            result = _execute_operation(df, plan["operation"])
        else:
            raise e

    result["plan"] = plan
    result["used_llm"] = used_llm
    return result
