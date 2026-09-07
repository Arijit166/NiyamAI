"""
validator.py
------------
Validation layer. Never trusts an extracted/normalized field at face
value — every field gets checked against a format rule (regex,
checksum-ish structure, or a cross-field consistency rule) before it's
allowed to be reported as "valid".

Nothing in here invents or corrects values (that's normalizer.py's job).
A validator either confirms a value is well-formed or flags it — it never
rewrites it.

Exposes:
    validate_email / validate_url / validate_phone / validate_pincode /
    validate_fssai / validate_gst / validate_mfg_license / validate_date
        -> each returns {"valid": bool, "reason": str|None}

    cross_field_validate(structured_data, normalized)
        -> list of {"rule": str, "passed": bool, "detail": str}

    build_review_flags(structured_data, field_validations, cross_field_results)
        -> {"needs_manual_review": bool, "review_reason": [str, ...]}
"""

import re
from typing import Any, Dict, List, Optional

from normalizer import PIN_PREFIX_TO_STATE
from postprocess import validate_date_pair

# ---------------------------------------------------------------------------
# Single-field validators
# ---------------------------------------------------------------------------

_EMAIL_RE = re.compile(r"^[\w.\-+]+@[\w\-]+\.[a-zA-Z]{2,}$")
_URL_RE = re.compile(r"^https?://[\w\-.]+\.[a-zA-Z]{2,}(/\S*)?$")
_INDIAN_MOBILE_RE = re.compile(r"^[6-9]\d{9}$")
_TOLL_FREE_RE = re.compile(r"^1800\d{6,7}$")
_LANDLINE_RE = re.compile(r"^\d{2,4}\d{6,8}$")
_PINCODE_RE = re.compile(r"^\d{6}$")

# FSSAI license numbers are 14 digits.
_FSSAI_RE = re.compile(r"^\d{14}$")

# GSTIN: 2-digit state code + 10-char PAN + 1 entity code + 1 'Z' by
# default + 1 checksum char. We validate the shape, not the checksum.
_GST_RE = re.compile(r"^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$")


def validate_email(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {"valid": False, "reason": "empty"}
    ok = bool(_EMAIL_RE.match(value.strip()))
    return {"valid": ok, "reason": None if ok else "does not match email pattern"}


def validate_url(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {"valid": False, "reason": "empty"}
    ok = bool(_URL_RE.match(value.strip()))
    return {"valid": ok, "reason": None if ok else "does not match URL pattern"}


def validate_phone(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {"valid": False, "reason": "empty"}
    digits = re.sub(r"\D", "", value)
    if _TOLL_FREE_RE.match(digits):
        return {"valid": True, "reason": None}
    if _INDIAN_MOBILE_RE.match(digits):
        return {"valid": True, "reason": None}
    if _LANDLINE_RE.match(digits) and len(digits) in (8, 9, 10, 11):
        return {"valid": True, "reason": None}
    return {"valid": False, "reason": f"'{value}' does not match a known phone format"}


def validate_pincode(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {"valid": False, "reason": "empty"}
    ok = bool(_PINCODE_RE.match(value.strip()))
    if not ok:
        return {"valid": False, "reason": "not a 6-digit PIN code"}
    if value[:2] not in PIN_PREFIX_TO_STATE:
        return {"valid": True, "reason": "6-digit format ok, prefix not in known-state table"}
    return {"valid": True, "reason": None}


def validate_fssai(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {"valid": False, "reason": "empty"}
    digits = re.sub(r"\D", "", value)
    ok = bool(_FSSAI_RE.match(digits))
    return {"valid": ok, "reason": None if ok else "FSSAI license number must be 14 digits"}


def validate_gst(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {"valid": False, "reason": "empty"}
    ok = bool(_GST_RE.match(value.strip().upper()))
    return {"valid": ok, "reason": None if ok else "does not match GSTIN shape"}


def validate_mfg_license(value: Optional[str]) -> Dict[str, Any]:
    """Loose validator — Mfg. Lic. No. formats vary widely by state/drug
    authority, so this only rejects obviously-empty or too-short values."""
    if not value:
        return {"valid": False, "reason": "empty"}
    cleaned = re.sub(r"\s+", "", value)
    ok = len(cleaned) >= 4 and bool(re.search(r"[A-Za-z0-9]", cleaned))
    return {"valid": ok, "reason": None if ok else "too short/no alphanumeric content"}


def validate_date_value(iso_value: Optional[str]) -> Dict[str, Any]:
    if not iso_value:
        return {"valid": False, "reason": "empty"}
    ok = bool(re.match(r"^\d{4}(-\d{2}){1,2}$", iso_value))
    return {"valid": ok, "reason": None if ok else "not a normalized ISO date/month"}


def validate_mrp_value(value: Optional[str]) -> Dict[str, Any]:
    if not value:
        return {"valid": False, "reason": "empty"}
    m = re.search(r"\d+(?:\.\d+)?", value)
    if not m:
        return {"valid": False, "reason": "no numeric amount found"}
    amount = float(m.group(0))
    ok = 1 <= amount < 100000
    return {"valid": ok, "reason": None if ok else f"amount {amount} out of plausible range"}


_FIELD_VALIDATORS = {
    "consumer_care_email": validate_email,
    "email": validate_email,
    "website": validate_url,
    "phone": validate_phone,
    "consumer_care": validate_phone,
    "pincode": validate_pincode,
    "mfg_license_no": validate_mfg_license,
    "fssai": validate_fssai,
    "gstin": validate_gst,
    "manufacturing_date": validate_date_value,
    "expiry_date": validate_date_value,
    "mrp": validate_mrp_value,
}


def validate_field(field_name: str, value: Optional[str]) -> Dict[str, Any]:
    """Dispatches to the right validator for a known field name. Fields
    with no registered validator (free-text fields like manufacturer,
    marketer, brand) are considered valid as long as they're non-empty."""
    # consumer_care can legitimately hold either an email or a phone number
    # (or a toll-free line) — pick the right validator by shape rather than
    # forcing it through validate_phone unconditionally.
    if field_name == "consumer_care" and value:
        return validate_email(value) if "@" in value else validate_phone(value)

    validator = _FIELD_VALIDATORS.get(field_name)
    if validator:
        return validator(value)
    if value and str(value).strip() and str(value).strip().upper() != "UNKNOWN":
        return {"valid": True, "reason": None}
    return {"valid": False, "reason": "empty or UNKNOWN"}


# ---------------------------------------------------------------------------
# Cross-field validation
# ---------------------------------------------------------------------------

def _present(structured_data: Dict[str, Any], key: str) -> bool:
    val = structured_data.get(key)
    return bool(val) and str(val).strip().upper() != "UNKNOWN"


def cross_field_validate(
    structured_data: Dict[str, Any],
    address_info: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Runs a set of consistency rules across already-extracted fields.
    Each result: {"rule": str, "passed": bool, "detail": str}
    """
    results: List[Dict[str, Any]] = []
    address_info = address_info or {}

    # 1. Manufacturer address state vs manufacturer-declared state / PIN prefix.
    addr_state = address_info.get("state")
    addr_pincode = address_info.get("pincode")
    if addr_state and addr_pincode:
        expected_state = PIN_PREFIX_TO_STATE.get(addr_pincode[:2])
        if expected_state:
            passed = expected_state.lower() == addr_state.lower()
            results.append({
                "rule": "address_state_matches_pincode",
                "passed": passed,
                "detail": (
                    f"address state '{addr_state}' vs PIN-implied state '{expected_state}'"
                    if not passed else "address state matches PIN-implied state"
                ),
            })

    # 2. Manufacturing date must precede expiry date.
    mfg = structured_data.get("manufacturing_date_normalized") or structured_data.get("manufacturing_date")
    exp = structured_data.get("expiry_date_normalized") or structured_data.get("expiry_date")
    if mfg and exp and str(mfg).upper() != "UNKNOWN" and str(exp).upper() != "UNKNOWN":
        ok, reason = validate_date_pair(mfg, exp)
        results.append({
            "rule": "expiry_after_manufacturing",
            "passed": ok,
            "detail": reason or "expiry date is after manufacturing date",
        })

    # 3. MRP present -> net quantity should also be present (Legal Metrology
    #    requires both on a package).
    if _present(structured_data, "mrp"):
        passed = _present(structured_data, "net_quantity")
        results.append({
            "rule": "mrp_implies_net_quantity",
            "passed": passed,
            "detail": "net_quantity missing despite mrp being present" if not passed else "net_quantity present",
        })

    # 4. Expiry present -> manufacturing date is commonly present too (soft rule).
    if _present(structured_data, "expiry_date"):
        passed = _present(structured_data, "manufacturing_date")
        results.append({
            "rule": "expiry_implies_manufacturing_date",
            "passed": passed,
            "detail": "manufacturing_date missing despite expiry_date being present" if not passed else "manufacturing_date present",
        })

    # 5. Manufacturer present -> a license number is often present too (soft rule).
    if _present(structured_data, "manufacturer"):
        passed = _present(structured_data, "mfg_license_no")
        results.append({
            "rule": "manufacturer_implies_license",
            "passed": passed,
            "detail": "mfg_license_no missing despite manufacturer being present" if not passed else "mfg_license_no present",
        })

    return results


# ---------------------------------------------------------------------------
# Review flags
# ---------------------------------------------------------------------------

# Rules whose failure is a hard signal something is actually wrong (not just
# a "nice to have" field missing) — these always force manual review.
_HARD_RULES = {"address_state_matches_pincode", "expiry_after_manufacturing"}


def build_review_flags(
    structured_data: Dict[str, Any],
    field_validations: Dict[str, Dict[str, Any]],
    cross_field_results: List[Dict[str, Any]],
    uncertain_or_flagged_text: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    reasons: List[str] = []

    for field, result in field_validations.items():
        if structured_data.get(field, "UNKNOWN") == "UNKNOWN":
            continue
        if not result.get("valid"):
            reasons.append(f"{field}: {result.get('reason') or 'failed validation'}")

    for rule_result in cross_field_results:
        if not rule_result["passed"] and rule_result["rule"] in _HARD_RULES:
            reasons.append(f"cross-field check failed ({rule_result['rule']}): {rule_result['detail']}")

    critical_fields = ["manufacturer", "mrp", "expiry_date", "net_quantity", "batch_number"]
    for field in critical_fields:
        if structured_data.get(field, "UNKNOWN") == "UNKNOWN":
            reasons.append(f"{field} not detected")

    if uncertain_or_flagged_text:
        for item in uncertain_or_flagged_text:
            field = item.get("field")
            if field:
                reasons.append(f"{field}: not detected anywhere in OCR text")
            else:
                reasons.append(
                    f"low-confidence OCR text near '{item.get('ocr_text')}': {item.get('reason')}"
                )

    return {
        "needs_manual_review": bool(reasons),
        "review_reason": reasons,
    }