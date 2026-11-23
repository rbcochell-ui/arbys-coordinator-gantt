"""Synthetic-only checks for the held multi-selection builder."""

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from builder import SelectionReviewError, build_reviewed_selection


NOW = datetime(2026, 11, 23, 13, 0, tzinfo=timezone.utc)
OBSERVED = "2026-11-23T12:00:00Z"
SOURCE_SHA = "a" * 64


def sf18(base: str) -> str:
    assert len(base) == 15 and base.startswith("0WO")
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
    suffix = ""
    for start in (0, 5, 10):
        bits = sum(1 << offset for offset, char in enumerate(base[start:start + 5])
                   if "A" <= char <= "Z")
        suffix += alphabet[bits]
    return base + suffix


WO_A = sf18("0WO000000000001")
WO_B = sf18("0WO000000000002")
WO_UNKNOWN = sf18("0WO000000000003")
FORM_A = "F:111:1001"
FORM_B = "F:111:1002"


def make_wo(wo_id: str, agent: str, *, bridge_only: bool = False) -> dict:
    number = "900001" if wo_id == WO_A else "900002"
    wo = {
        "id": wo_id, "number": number, "type": "Installation",
        "status": "Pending Readiness", "serviceType":
        "A - Install Fountain Dispenser Equipment",
        "assignedSpAgentCode": agent, "woStore": "10001", "acn": "123456",
        "providerContactCandidate": {
            "state": "two_source_file_candidate",
            "installManagerEmail": "manager@example.invalid",
            "plannerEmail": "planner@example.invalid",
        },
    }
    if not bridge_only:
        wo["nativeFields"] = {
            "Work Order ID": wo_id[:15], "Work Order Number": number,
            "Assigned SP - Name": f"{agent} - Example Service Provider",
        }
    return wo


def fixture() -> tuple[dict, dict, dict]:
    first = make_wo(WO_A, "A1", bridge_only=True)
    second = make_wo(WO_B, "B2")
    snapshot = {
        "schema": "arbys-local-exact-form-project-preview/v16",
        "asOfDate": "2026-11-23", "counts": {"nativeWorkOrders": 2},
        "projects": [
            {"caseKey": FORM_A, "cases": [{"workOrders": [first]}]},
            {"caseKey": FORM_B, "cases": [{"workOrders": [second]}]},
        ],
    }
    overlay = {
        "schema": "ArbysProviderVisitSourceOverlay/v2",
        "sourceSha256": SOURCE_SHA, "observedAtUtc": OBSERVED,
        "reportId": "00O000000000000000",
        "sourceRows": 2, "rows": {},
    }
    for wo in (first, second):
        overlay["rows"][wo["id"]] = {
            "nativeWorkOrderId": wo["id"][:15],
            "workOrderNumber": wo["number"],
            "activityType": "Installation", "workOrderType": wo["type"],
            "serviceType": wo["serviceType"], "status": wo["status"],
            "hold": "0", "spStatus": "OPN - To Be Planned",
        }
    route = {
        "schema": "ArbysGanttSelection/v1", "actionsEnabled": False,
        "providerAllowedNativeWorkOrderIds": [WO_A],
        "customerAllowedFormSourceKeys": [FORM_A],
    }
    return snapshot, overlay, route


def html_of(snapshot: dict, overlay: dict, route: dict) -> str:
    def script(name: str, data: dict) -> str:
        return (f'<script type="application/json" id="{name}">'
                + json.dumps(data, separators=(",", ":")) + "</script>")
    return ("<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" "
            "content=\"default-src 'none'; connect-src 'none'; "
            "form-action 'none'; frame-src 'none'\"></head><body>"
            + script("snapshotData", snapshot)
            + script("providerVisitSourceOverlay", overlay)
            + script("actionRoutes", route) + "</body></html>")


def review_of(html: str, provider_ids: list[str] | None = None,
              customer_keys: list[str] | None = None) -> dict:
    return {
        "schema": "ArbysGanttSelectionReview/v2",
        "sourceHtmlSha256": hashlib.sha256(html.encode("utf-8")).hexdigest(),
        "sourceReportSha256": SOURCE_SHA,
        "sourceObservedAtUtc": OBSERVED,
        "snapshotAsOfDate": "2026-11-23",
        "reviewedAtUtc": "2026-11-23T12:05:00Z",
        "validUntilUtc": "2026-11-24T11:59:00Z",
        "providerNativeWorkOrderIds": provider_ids if provider_ids is not None
            else [WO_A, WO_B],
        "customerFormSourceKeys": customer_keys if customer_keys is not None
            else [FORM_A, FORM_B],
    }


def embedded(html: str, name: str) -> str:
    match = re.search(rf'<script type="application/json" id="{name}">([^<]+)</script>', html)
    assert match is not None
    return match.group(1)


class ReviewedSelectionTests(unittest.TestCase):
    def assert_held(self, html: str, review: dict, code: str) -> None:
        with self.assertRaises(SelectionReviewError) as error:
            build_reviewed_selection(html, review, now_utc=NOW)
        self.assertEqual(error.exception.code, code)

    def test_two_exact_preinstall_visits_and_two_customer_projects(self):
        snapshot, overlay, route = fixture()
        html = html_of(snapshot, overlay, route)
        result = build_reviewed_selection(html, review_of(html), now_utc=NOW)
        saved = json.loads(embedded(result, "actionRoutes"))
        self.assertIs(saved["actionsEnabled"], False)
        self.assertEqual(saved["providerAllowedNativeWorkOrderIds"], [WO_A, WO_B])
        self.assertEqual(saved["customerAllowedFormSourceKeys"], [FORM_A, FORM_B])
        self.assertEqual(embedded(result, "snapshotData"), embedded(html, "snapshotData"))
        self.assertEqual(embedded(result, "providerVisitSourceOverlay"),
                         embedded(html, "providerVisitSourceOverlay"))
        self.assertNotIn("manager@example.invalid", embedded(result, "actionRoutes"))

    def test_empty_held_allowlists_can_receive_a_reviewed_selection(self):
        snapshot, overlay, route = fixture()
        route["providerAllowedNativeWorkOrderIds"] = []
        route["customerAllowedFormSourceKeys"] = []
        html = html_of(snapshot, overlay, route)
        result = build_reviewed_selection(html, review_of(html), now_utc=NOW)
        self.assertEqual(json.loads(embedded(result, "actionRoutes"))
                         ["providerAllowedNativeWorkOrderIds"], [WO_A, WO_B])

    def test_fractional_second_overlay_time_matches_runtime_format(self):
        snapshot, overlay, route = fixture()
        overlay["observedAtUtc"] = "2026-11-23T12:00:00.123Z"
        html = html_of(snapshot, overlay, route)
        review = review_of(html)
        review["sourceObservedAtUtc"] = overlay["observedAtUtc"]
        result = build_reviewed_selection(html, review, now_utc=NOW)
        self.assertIn(WO_A, json.loads(embedded(result, "actionRoutes"))
                      ["providerAllowedNativeWorkOrderIds"])

    def test_chart_overlay_phase_drift_stops_selection(self):
        snapshot, overlay, route = fixture()
        snapshot["projects"][1]["cases"][0]["workOrders"][0]["status"] = \
            "Pending Scheduled Date"
        html = html_of(snapshot, overlay, route)
        self.assert_held(html, review_of(html), "REVIEW_PROVIDER_NOT_ELIGIBLE")

    def test_missing_duplicate_and_noncanonical_ids_stop_selection(self):
        snapshot, overlay, route = fixture()
        html = html_of(snapshot, overlay, route)
        for ids in ([WO_A, WO_UNKNOWN], [WO_A, WO_A], [WO_A, WO_B[:-1] + "Z"]):
            with self.subTest(ids=ids):
                code = ("REVIEW_PROVIDER_IDS_INVALID" if ids[0] == ids[1] or
                        ids[1].endswith("Z") else "REVIEW_PROVIDER_NOT_ELIGIBLE")
                self.assert_held(html, review_of(html, provider_ids=ids), code)
        self.assert_held(html, review_of(html, customer_keys=[FORM_A, FORM_A]),
                         "REVIEW_CUSTOMER_KEYS_INVALID")
        self.assert_held(html, review_of(html, customer_keys=[FORM_A, "F:111:9999"]),
                         "REVIEW_CUSTOMER_KEY_NOT_CHARTED")

    def test_agent_code_alone_never_supplies_a_contact_pair(self):
        snapshot, overlay, route = fixture()
        second = snapshot["projects"][1]["cases"][0]["workOrders"][0]
        second["assignedSpAgentCode"] = "A1"  # Same agent as the valid first WO.
        second["nativeFields"]["Assigned SP - Name"] = "A1 - Example Service Provider"
        second.pop("providerContactCandidate")
        html = html_of(snapshot, overlay, route)
        self.assert_held(html, review_of(html), "REVIEW_PROVIDER_NOT_ELIGIBLE")
        # Selecting only the evidence-bearing WO succeeds without looking up
        # another WO's recipients by its shared agent code.
        result = build_reviewed_selection(
            html, review_of(html, provider_ids=[WO_A]), now_utc=NOW)
        self.assertEqual(json.loads(embedded(result, "actionRoutes"))
                         ["providerAllowedNativeWorkOrderIds"], [WO_A])

    def test_explicit_relocation_can_be_selected(self):
        snapshot, overlay, route = fixture()
        wo = snapshot["projects"][1]["cases"][0]["workOrders"][0]
        wo["type"] = "Relocation"
        wo["serviceType"] = "8 - Relocate/Remodel"
        overlay["rows"][WO_B]["workOrderType"] = "Relocation"
        overlay["rows"][WO_B]["serviceType"] = wo["serviceType"]
        html = html_of(snapshot, overlay, route)
        result = build_reviewed_selection(html, review_of(html), now_utc=NOW)
        self.assertEqual(json.loads(embedded(result, "actionRoutes"))
                         ["providerAllowedNativeWorkOrderIds"], [WO_A, WO_B])

    def test_held_contract_source_digest_and_expiry(self):
        snapshot, overlay, route = fixture()
        html = html_of(snapshot, overlay, route)
        altered = deepcopy(route)
        altered["actionsEnabled"] = True
        changed = html_of(snapshot, overlay, altered)
        self.assert_held(changed, review_of(changed), "HELD_SELECTION_CONTRACT_INVALID")
        digest_review = review_of(html)
        digest_review["sourceHtmlSha256"] = "b" * 64
        self.assert_held(html, digest_review, "REVIEW_SOURCE_DIGEST_MISMATCH")
        stale = review_of(html)
        stale["validUntilUtc"] = "2026-11-23T12:30:00Z"
        self.assert_held(html, stale, "REVIEW_EXPIRED")

    def test_held_or_other_visit_cannot_be_added(self):
        snapshot, overlay, route = fixture()
        overlay["rows"][WO_B]["hold"] = "1"
        html = html_of(snapshot, overlay, route)
        self.assert_held(html, review_of(html), "REVIEW_PROVIDER_NOT_ELIGIBLE")

    def test_provider_selection_matches_runtime_identity_and_contact_limits(self):
        def reject(change):
            snapshot, overlay, route = fixture()
            wo = snapshot["projects"][1]["cases"][0]["workOrders"][0]
            change(wo, overlay["rows"][WO_B])
            html = html_of(snapshot, overlay, route)
            self.assert_held(html, review_of(html), "REVIEW_PROVIDER_NOT_ELIGIBLE")

        changes = (
            lambda wo, row: wo["providerContactCandidate"].update(
                matchMethod="exact_store_acn_agent"),
            lambda wo, row: wo["providerContactCandidate"].update(
                matchMethod=None),
            lambda wo, row: wo["providerContactCandidate"].update(
                storeNumberStillMissing=False),
            lambda wo, row: wo.update(nativeFields=None),
            lambda wo, row: wo.update(woStore=10001),
            lambda wo, row: wo.update(acn=123456),
            lambda wo, row: wo["providerContactCandidate"].update(
                installManagerEmail="m" * 250 + "@example.invalid"),
            lambda wo, row: row.update(spStatus=" HLD - Hold"),
        )
        for change in changes:
            with self.subTest(change=changes.index(change)):
                reject(change)

        snapshot, overlay, route = fixture()
        wo = snapshot["projects"][1]["cases"][0]["workOrders"][0]
        wo["number"] = "1234"
        wo["nativeFields"]["Work Order Number"] = "1234"
        overlay["rows"][WO_B]["workOrderNumber"] = "1234"
        html = html_of(snapshot, overlay, route)
        self.assert_held(html, review_of(html), "REVIEW_PROVIDER_NOT_ELIGIBLE")

    def test_runtime_overlay_and_html_limits_are_enforced(self):
        snapshot, overlay, route = fixture()
        del overlay["reportId"]
        html = html_of(snapshot, overlay, route)
        self.assert_held(html, review_of(html), "REVIEW_EMBEDDED_SOURCE_MISMATCH")

        snapshot, overlay, route = fixture()
        overlay["sourceRows"] = True
        html = html_of(snapshot, overlay, route)
        self.assert_held(html, review_of(html), "REVIEW_EMBEDDED_SOURCE_MISMATCH")

        snapshot, overlay, route = fixture()
        snapshot["asOfDate"] = "2026-11-25"
        html = html_of(snapshot, overlay, route)
        review = review_of(html)
        review["snapshotAsOfDate"] = "2026-11-25"
        self.assert_held(html, review, "REVIEW_EMBEDDED_SOURCE_MISMATCH")

        snapshot, overlay, route = fixture()
        html = html_of(snapshot, overlay, route)
        padded = html.replace("</body>", "<!--" + "x" * 800_000 + "--></body>")
        self.assert_held(padded, review_of(padded), "REVIEW_INPUT_INVALID")

        legacy = html.replace("</body>", "<p>data-action-route</p></body>")
        self.assert_held(legacy, review_of(legacy), "REVIEW_INPUT_INVALID")

        malformed_duplicate = html.replace(
            "</body>", '<script type="application/json" id="actionRoutes"></script></body>')
        self.assert_held(malformed_duplicate, review_of(malformed_duplicate),
                         "EMBEDDED_SOURCE_NOT_SINGLETON")

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for cross-module parity")
    def test_selected_wo_has_the_same_exact_pair_in_runtime(self):
        snapshot, overlay, route = fixture()
        html = html_of(snapshot, overlay, route)
        built = build_reviewed_selection(html, review_of(html), now_utc=NOW)
        script = Path(__file__).with_name("runtime_parity.mjs")
        request = {
            "html": built,
            "sha256": hashlib.sha256(built.encode("utf-8")).hexdigest(),
            "ids": [WO_A, WO_B],
            "nowMs": int(NOW.timestamp() * 1000),
        }
        run = subprocess.run(
            ["node", str(script)], input=json.dumps(request), text=True,
            capture_output=True, check=True, timeout=10)
        actual = json.loads(run.stdout)
        self.assertEqual(actual, [
            {"eligible": True, "exactPair": True, "recipientCount": 2},
            {"eligible": True, "exactPair": True, "recipientCount": 2},
        ])
        snapshot, overlay, route = fixture()
        wo = snapshot["projects"][1]["cases"][0]["workOrders"][0]
        wo["serviceType"] = "9 - Water Filter Only"
        overlay["rows"][WO_B]["serviceType"] = wo["serviceType"]
        html = html_of(snapshot, overlay, route)
        self.assert_held(html, review_of(html), "REVIEW_PROVIDER_NOT_ELIGIBLE")
        snapshot, overlay, route = fixture()
        wo = snapshot["projects"][1]["cases"][0]["workOrders"][0]
        wo["type"] = "Other"
        wo["serviceType"] = "8 - Relocate/Remodel"
        overlay["rows"][WO_B]["workOrderType"] = "Other"
        overlay["rows"][WO_B]["serviceType"] = "8 - Relocate/Remodel"
        html = html_of(snapshot, overlay, route)
        self.assert_held(html, review_of(html), "REVIEW_PROVIDER_NOT_ELIGIBLE")


if __name__ == "__main__":
    unittest.main()
