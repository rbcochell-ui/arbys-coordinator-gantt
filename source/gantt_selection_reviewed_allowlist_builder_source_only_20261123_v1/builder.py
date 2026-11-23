"""Build a held Gantt selection contract from a separate reviewed cohort.

The input is an already held private chart. This module neither reads contact
workbooks nor publishes a page; it only replaces the chart's selection JSON.
The review record and resulting HTML must stay outside the public site tree.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import re
from typing import Any
import unicodedata


_MAX_HTML_BYTES = 1_000_000
_MAX_HTML_CHARACTERS = 800_000
_MAX_SELECTION_CHARACTERS = 4_096
_MAX_SELECTIONS = 50
_MAX_SOURCE_AGE = timedelta(hours=24)
_PREINSTALL = frozenset({"Pending Readiness", "Pending Scheduled Date"})
_INSTALL_CODES = frozenset({"A", "B", "C", "D", "3", "9", "8"})
_REVIEW_KEYS = frozenset({
    "schema", "sourceHtmlSha256", "sourceReportSha256",
    "sourceObservedAtUtc", "snapshotAsOfDate", "reviewedAtUtc",
    "validUntilUtc", "providerNativeWorkOrderIds", "customerFormSourceKeys",
})
_SELECTION_KEYS = frozenset({
    "schema", "actionsEnabled", "providerAllowedNativeWorkOrderIds",
    "customerAllowedFormSourceKeys",
})
_SHA = re.compile(r"^[0-9a-f]{64}$")
_WO_ID = re.compile(r"^0WO[A-Za-z0-9]{15}$")
_FORM_KEY = re.compile(r"^F:[0-9]{1,20}:[0-9]{1,20}$")
_AGENT = re.compile(r"^[A-Z][A-Z0-9]{0,9}$")
_DIGITS = re.compile(r"^[0-9]+$")
_WO_NUMBER = re.compile(r"^[0-9]{5,12}$")
_REPORT_ID = re.compile(r"^00O[A-Za-z0-9]{15}$")
_EMAIL = re.compile(r"^[^\s@<>\"',;]+@[^\s@<>\"',;]+\.[^\s@<>\"',;]+$")
_UTC = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$")
_SERVICE_CODE = re.compile(r"^([A-Z0-9]{1,3})(?:\s*-\s*|$)", re.I)
_BLOCKED_SP = re.compile(r"^(?:HLD|CMP|CNL|CNC|CLS)(?:\b|\s|-)", re.I)


class SelectionReviewError(ValueError):
    """A stable, non-sensitive held reason for a rejected private build."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise SelectionReviewError(code)


def _object(value: Any) -> bool:
    return isinstance(value, dict)


def _sha(value: Any) -> bool:
    return isinstance(value, str) and bool(_SHA.fullmatch(value))


def _utc(value: Any, code: str) -> datetime:
    if not isinstance(value, str) or not _UTC.fullmatch(value):
        _fail(code)
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError:
        _fail(code)
    return parsed.astimezone(timezone.utc)


def _exact_date(value: Any) -> bool:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _js_string_length(value: str) -> int:
    """Count UTF-16 code units, as the integrated JavaScript viewer does."""
    try:
        return len(value.encode("utf-16-le")) // 2
    except UnicodeEncodeError:
        _fail("REVIEW_INPUT_INVALID")


def _sf18(value: Any) -> bool:
    if not isinstance(value, str) or not _WO_ID.fullmatch(value):
        return False
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
    suffix = ""
    for start in (0, 5, 10):
        bits = sum(1 << offset for offset, char in enumerate(value[start:start + 5])
                   if "A" <= char <= "Z")
        suffix += alphabet[bits]
    return value[15:] == suffix


def _unique_list(value: Any, *, pattern: re.Pattern[str] | None,
                 code: str, sf18: bool = False, min_length: int = 1) -> list[str]:
    if not isinstance(value, list) or not min_length <= len(value) <= _MAX_SELECTIONS:
        _fail(code)
    if any(not isinstance(item, str) or
           (not _sf18(item) if sf18 else not pattern.fullmatch(item))
           for item in value):
        _fail(code)
    if len(set(value)) != len(value):
        _fail(code)
    return value


def _embedded(html: str, marker: str, *, max_chars: int = 800_000
              ) -> tuple[re.Match[str], dict[str, Any]]:
    opening = f'<script type="application/json" id="{marker}">'
    if html.count(opening) != 1:
        _fail("EMBEDDED_SOURCE_NOT_SINGLETON")
    pattern = re.compile(
        rf'<script type="application/json" id="{re.escape(marker)}">([^<]{{1,{max_chars}}})</script>'
    )
    matches = list(pattern.finditer(html))
    if len(matches) != 1:
        _fail("EMBEDDED_SOURCE_NOT_SINGLETON")
    try:
        value = json.loads(matches[0].group(1))
    except json.JSONDecodeError:
        _fail("EMBEDDED_SOURCE_INVALID")
    if not _object(value):
        _fail("EMBEDDED_SOURCE_INVALID")
    return matches[0], value


def _chart_index(snapshot: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], set[str]]:
    if (snapshot.get("schema") != "arbys-local-exact-form-project-preview/v16" or
            not _exact_date(snapshot.get("asOfDate")) or
            not isinstance(snapshot.get("projects"), list) or
            not _object(snapshot.get("counts"))):
        _fail("CHART_SCHEMA_INVALID")
    projects = snapshot["projects"]
    if not 1 <= len(projects) <= 100:
        _fail("CHART_SCHEMA_INVALID")
    work_orders: dict[str, dict[str, Any]] = {}
    form_keys: set[str] = set()
    for project in projects:
        if not _object(project) or not isinstance(project.get("cases"), list):
            _fail("CHART_SCHEMA_INVALID")
        key = project.get("caseKey")
        if (not isinstance(key, str) or not _FORM_KEY.fullmatch(key) or
                key in form_keys):
            _fail("CHART_FORM_KEY_INVALID")
        form_keys.add(key)
        for one_case in project["cases"]:
            if not _object(one_case) or not isinstance(one_case.get("workOrders"), list):
                _fail("CHART_SCHEMA_INVALID")
            for wo in one_case["workOrders"]:
                if not _object(wo) or not _sf18(wo.get("id")):
                    _fail("CHART_WO_ID_INVALID")
                if wo["id"] in work_orders:
                    _fail("CHART_WO_NOT_UNIQUE")
                work_orders[wo["id"]] = wo
    if (type(snapshot["counts"].get("nativeWorkOrders")) is not int or
            len(work_orders) != snapshot["counts"]["nativeWorkOrders"] or
            not 1 <= len(work_orders) <= 500):
        _fail("CHART_WO_COUNT_MISMATCH")
    return work_orders, form_keys


def _provider_eligible(wo: dict[str, Any], row: dict[str, Any]) -> bool:
    wo_id = wo["id"]
    agent = wo.get("assignedSpAgentCode")
    number = wo.get("number")
    service = wo.get("serviceType")
    if (not isinstance(agent, str) or not _AGENT.fullmatch(agent) or
            not isinstance(number, str) or not _WO_NUMBER.fullmatch(number) or
            not isinstance(service, str) or
            not isinstance(wo.get("woStore"), str) or
            not _DIGITS.fullmatch(wo["woStore"]) or
            not isinstance(wo.get("acn"), str) or
            not _DIGITS.fullmatch(wo["acn"])):
        return False
    match = _SERVICE_CODE.match(service)
    code = match.group(1).upper() if match else None
    scope = unicodedata.normalize("NFKC", service).lower()
    scope = re.sub(r"[\u2010-\u2015]", "-", scope)
    scope = re.sub(r"[_/]", " ", scope)
    scope = re.sub(r"\s+", " ", scope)
    if (re.search(r"\b(?:survey|line[ -]*run|run[ -]*lines|fire[ -]*up)\b", scope) or
            re.search(r"\bfilter[ -]*only\b", scope) or
            (re.search(r"\bwater[ -]*filter\b", scope) and
             not re.search(r"\bfountain\b", scope))):
        return False
    if not ((wo.get("type") == "Installation" and code in _INSTALL_CODES) or
            (wo.get("type") == "Relocation" and code == "8")):
        return False
    if (wo.get("status") not in _PREINSTALL or
            row.get("status") != wo["status"] or
            row.get("nativeWorkOrderId") != wo_id[:15] or
            row.get("workOrderNumber") != number or
            row.get("workOrderType") != wo["type"] or
            row.get("serviceType") != service or
            row.get("activityType") != "Installation" or
            row.get("hold") != "0" or
            not isinstance(row.get("spStatus"), str) or
            _BLOCKED_SP.search(row["spStatus"].strip())):
        return False
    native = wo.get("nativeFields")
    if "nativeFields" in wo and (
            not _object(native) or
            native.get("Work Order ID") != wo_id[:15] or
            native.get("Work Order Number") != number or
            not isinstance(native.get("Assigned SP - Name"), str) or
            not native["Assigned SP - Name"].startswith(f"{agent} - ")):
        return False
    # The candidate must belong to this exact work order. There is no search
    # or fallback by agent code; a missing pair keeps this WO out of the route.
    candidate = wo.get("providerContactCandidate")
    if not _object(candidate) or candidate.get("state") != "two_source_file_candidate":
        return False
    # The runtime resolver treats only an omitted matchMethod as the exact
    # Store + ACN route. Explicit null or a declared exact route is held.
    if "matchMethod" in candidate or "storeNumberStillMissing" in candidate:
        return False
    for role in ("installManagerEmail", "plannerEmail"):
        address = candidate.get(role)
        if (not isinstance(address, str) or address != address.strip() or
                len(address) > 254 or
                not _EMAIL.fullmatch(address)):
            return False
    return True


def build_reviewed_selection(held_html: str, review: dict[str, Any],
                             *, now_utc: datetime | None = None) -> str:
    """Return held private HTML with the exact reviewed selection lists.

    Review values come from a separately controlled review record. This code
    verifies the source digest and mechanical eligibility, not reviewer identity.
    It deliberately keeps ``actionsEnabled`` false and performs no I/O.
    """
    if (not isinstance(held_html, str) or
            not held_html.lower().startswith("<!doctype html>") or
            len(held_html.encode("utf-8")) > _MAX_HTML_BYTES or
            _js_string_length(held_html) > _MAX_HTML_CHARACTERS or
            re.search(r"apps\.powerapps\.com|data-action-route", held_html, re.I) or
            "connect-src 'none'" not in held_html or
            "form-action 'none'" not in held_html or
            "frame-src 'none'" not in held_html or
            not _object(review) or set(review) != _REVIEW_KEYS or
            review.get("schema") != "ArbysGanttSelectionReview/v2"):
        _fail("REVIEW_INPUT_INVALID")
    if (not _sha(review.get("sourceHtmlSha256")) or
            hashlib.sha256(held_html.encode("utf-8")).hexdigest() != review["sourceHtmlSha256"] or
            not _sha(review.get("sourceReportSha256"))):
        _fail("REVIEW_SOURCE_DIGEST_MISMATCH")
    current = now_utc or datetime.now(timezone.utc)
    if not isinstance(current, datetime) or current.tzinfo is None:
        _fail("CLOCK_INVALID")
    current = current.astimezone(timezone.utc)
    observed = _utc(review["sourceObservedAtUtc"], "REVIEW_TIME_INVALID")
    reviewed = _utc(review["reviewedAtUtc"], "REVIEW_TIME_INVALID")
    until = _utc(review["validUntilUtc"], "REVIEW_TIME_INVALID")
    if (observed > current + timedelta(minutes=1) or
            reviewed < observed or reviewed > current + timedelta(minutes=1) or
            until <= reviewed or until > observed + _MAX_SOURCE_AGE):
        _fail("REVIEW_TIME_INVALID")
    if current >= until or current >= observed + _MAX_SOURCE_AGE:
        _fail("REVIEW_EXPIRED")
    if not _exact_date(review.get("snapshotAsOfDate")):
        _fail("REVIEW_INPUT_INVALID")
    provider_ids = _unique_list(review.get("providerNativeWorkOrderIds"),
                                pattern=None, sf18=True,
                                code="REVIEW_PROVIDER_IDS_INVALID")
    customer_keys = _unique_list(review.get("customerFormSourceKeys"),
                                 pattern=_FORM_KEY,
                                 code="REVIEW_CUSTOMER_KEYS_INVALID")
    route_match, route = _embedded(
        held_html, "actionRoutes", max_chars=_MAX_SELECTION_CHARACTERS)
    if (set(route) != _SELECTION_KEYS or
            route.get("schema") != "ArbysGanttSelection/v1" or
            route.get("actionsEnabled") is not False):
        _fail("HELD_SELECTION_CONTRACT_INVALID")
    _unique_list(route.get("providerAllowedNativeWorkOrderIds"),
                 pattern=None, sf18=True, min_length=0,
                 code="HELD_SELECTION_CONTRACT_INVALID")
    _unique_list(route.get("customerAllowedFormSourceKeys"),
                 pattern=_FORM_KEY, min_length=0,
                 code="HELD_SELECTION_CONTRACT_INVALID")
    _, snapshot = _embedded(held_html, "snapshotData")
    _, overlay = _embedded(held_html, "providerVisitSourceOverlay")
    if (snapshot.get("asOfDate") != review["snapshotAsOfDate"] or
            overlay.get("schema") != "ArbysProviderVisitSourceOverlay/v2" or
            overlay.get("sourceSha256") != review["sourceReportSha256"] or
            overlay.get("observedAtUtc") != review["sourceObservedAtUtc"] or
            not isinstance(overlay.get("reportId"), str) or
            not _REPORT_ID.fullmatch(overlay["reportId"]) or
            not _object(overlay.get("rows")) or
            type(overlay.get("sourceRows")) is not int or
            overlay["sourceRows"] < 1):
        _fail("REVIEW_EMBEDDED_SOURCE_MISMATCH")
    if date.fromisoformat(snapshot["asOfDate"]) > (observed + _MAX_SOURCE_AGE).date():
        _fail("REVIEW_EMBEDDED_SOURCE_MISMATCH")
    work_orders, form_keys = _chart_index(snapshot)
    if (set(overlay["rows"]) != set(work_orders) or
            any(not _object(row) for row in overlay["rows"].values())):
        _fail("OVERLAY_COHORT_MISMATCH")
    for wo_id in provider_ids:
        wo, row = work_orders.get(wo_id), overlay["rows"].get(wo_id)
        if not _object(wo) or not _object(row) or not _provider_eligible(wo, row):
            _fail("REVIEW_PROVIDER_NOT_ELIGIBLE")
    if any(key not in form_keys for key in customer_keys):
        _fail("REVIEW_CUSTOMER_KEY_NOT_CHARTED")
    selection = {
        "schema": "ArbysGanttSelection/v1",
        "actionsEnabled": False,
        "providerAllowedNativeWorkOrderIds": provider_ids,
        "customerAllowedFormSourceKeys": customer_keys,
    }
    replacement = json.dumps(selection, separators=(",", ":"), ensure_ascii=True)
    if len(replacement) > _MAX_SELECTION_CHARACTERS:
        _fail("HELD_SELECTION_CONTRACT_INVALID")
    result = (held_html[:route_match.start(1)] + replacement +
              held_html[route_match.end(1):])
    if (_js_string_length(result) > _MAX_HTML_CHARACTERS or
            len(result.encode("utf-8")) > _MAX_HTML_BYTES):
        _fail("HELD_SELECTION_CONTRACT_INVALID")
    return result
