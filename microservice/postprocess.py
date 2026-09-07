"""
postprocess.py
---------------
Validates and normalizes raw OCR text per YOLO field class.

Same contract as validate_field_value / FIELD_VALUE_PATTERNS in your
ocr.py: a field with a predictable format gets a strict pattern, and text
that doesn't match is REJECTED rather than accepted or reshaped into a
best guess.

Changelog (robustness pass for real-world package labels):
    1. Brand validation now rejects OCR garbage (symbols-only, <2
       alphanumeric chars) instead of accepting anything non-empty.
    2. Product name rejects OCR results that are just another field's
       label word ("MRP", "Batch No", ...).
    3. net_quantity now recognizes multipacks ("2x100g", "2 x 100 g",
       "2×100 g") in addition to single-unit quantities.
    4. MRP extraction normalizes common OCR currency-marker mistakes
       ("R5" -> "RS", lone "S." -> "RS.", trailing "/-" stripped) and
       tolerates confusable digit characters (O/I/L/S/B) inside the
       captured amount before parsing.
    5. Date parsing supports many more formats (ISO "YYYY-MM-DD",
       "YYYY/MM", no-separator "JAN2025"/"052024", "MM.YY", etc.).
    6. Dot-matrix OCR digit confusion (O/I/L/S/B <-> 0/1/1/5/8) is fixed
       before parsing dates/prices — but only in numeric-looking tokens,
       never inside a recognized month abbreviation (so "FEB"/"SEP"/"OCT"
       aren't corrupted by the same S/O->5/0 fix that cleans up digits).
    7. Added validate_date_pair() so a caller with BOTH dates in hand can
       reject a manufacturing date that isn't strictly before the expiry
       date (e.g. "MFG 2025" + "EXP 2024"). This needs both values at
       once, so postprocess_field() (which handles one field at a time)
       can't apply it internally — pipeline.py should call it explicitly
       after both manufacturing_date and expiry_date have been extracted.
    8. MRP sanity range tightened to reject implausible extremes.
    9. Brand text strips trademark/registration symbols (®™©).
   10. product_name/brand strip trailing punctuation runs.

pipeline.py calls postprocess_field(field_class, raw_text) for each OCR
variant it tries, and keeps the first result where .valid is True.
"""

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Tuple


@dataclass
class FieldResult:
    raw_text: str
    value: Optional[str]   # normalized value, or None if extraction/validation failed
    valid: bool
    reason: Optional[str] = None


def _clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text.strip(" .,:;|_-")


def _strip_trailing_punctuation(text: str) -> str:
    """Removes runs of trailing punctuation OCR sometimes tacks on, e.g. 'Noodles....' -> 'Noodles'."""
    return re.sub(r"[.,:;]+$", "", text).strip()


# ---------------------------------------------------------------------------
# Shared: dot-matrix / low-quality-print digit confusion fixing
#
# Applied only to numeric-looking tokens, never to a recognized month
# abbreviation — so "FEB2025"/"SEP2025"/"OCT2025" keep their month name
# intact while a token like "12/0S/2024" or "O5-2024" still gets its
# digits corrected.
# ---------------------------------------------------------------------------
_DIGIT_CONFUSION_MAP = {
    "O": "0", "o": "0",
    "I": "1", "i": "1", "L": "1", "l": "1",
    "S": "5", "s": "5",
    "B": "8", "b": "8",
}
_MONTH_ABBRS = {
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "SEPT", "OCT", "NOV", "DEC",
}
_MONTH_PREFIX_RE = re.compile(r"^([A-Za-z]{3,4})(.*)$", re.DOTALL)


def _map_digits(segment: str) -> str:
    return "".join(_DIGIT_CONFUSION_MAP.get(ch, ch) for ch in segment)


def _fix_confusable_token(token: str) -> str:
    """
    Fixes O/I/L/S/B -> 0/1/1/5/8 confusions in a single whitespace-delimited
    token, without touching a leading month-name abbreviation if present.
    """
    m = _MONTH_PREFIX_RE.match(token)
    if m:
        prefix, rest = m.group(1), m.group(2)
        if prefix.upper() in _MONTH_ABBRS:
            return prefix + _map_digits(rest)
    if any(ch.isdigit() for ch in token):
        return _map_digits(token)
    return token


def fix_dotmatrix_confusions(text: str) -> str:
    """Applies _fix_confusable_token to every token in `text`, preserving whitespace."""
    return " ".join(_fix_confusable_token(tok) for tok in text.split(" "))


# ---------------------------------------------------------------------------
# net_quantity — e.g. "500 g", "1 kg", "250ml", "1.5 L", "2x100g", "2 x 100 g"
# ---------------------------------------------------------------------------
_UNIT_ALTS = r"(kg|g|gm|gms|mg|l|litre|liter|ltr|ml|pcs|pieces|n|units?)"
_QTY_UNIT_NORM = {"gm": "g", "gms": "g", "litre": "l", "liter": "l", "ltr": "l", "pieces": "pcs", "units": "n", "unit": "n"}

_MULTIPACK_QTY_RE = re.compile(
    rf"(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*{_UNIT_ALTS}\b", re.IGNORECASE
)
_SINGLE_QTY_RE = re.compile(
    rf"(\d+(?:\.\d+)?)\s*{_UNIT_ALTS}\b", re.IGNORECASE
)


def extract_net_quantity(raw_text: str) -> FieldResult:
    text = _clean(raw_text)

    multipack = _MULTIPACK_QTY_RE.search(text)
    if multipack:
        count, amount, unit = multipack.group(1), multipack.group(2), multipack.group(3)
        unit = _QTY_UNIT_NORM.get(unit.lower(), unit.lower())
        return FieldResult(raw_text, f"{count} x {amount} {unit}", True)

    single = _SINGLE_QTY_RE.search(text)
    if not single:
        return FieldResult(raw_text, None, False, "no quantity+unit pattern found")

    amount, unit = single.group(1), _QTY_UNIT_NORM.get(single.group(2).lower(), single.group(2).lower())
    return FieldResult(raw_text, f"{amount} {unit}", True)


# ---------------------------------------------------------------------------
# mrp — e.g. "MRP Rs. 199.00", "Rs 45/-", "₹120", "R5 45", "RS.45", "45/-"
# ---------------------------------------------------------------------------
# Amount groups accept confusable digit characters (O/I/L/S/B) in addition
# to real digits — they're isolated inside the currency/amount match, so
# mapping them to real digits afterward can't corrupt anything else.
_MRP_AMOUNT_CHARS = r"[0-9OIlLSsBb]"
_MRP_LABELED_RE = re.compile(
    rf"(?:mrp|rs\.?|inr|₹)\s*[:.]?\s*({_MRP_AMOUNT_CHARS}+(?:[.,]{_MRP_AMOUNT_CHARS}{{1,2}})?)",
    re.IGNORECASE,
)
_MRP_BARE_RE = re.compile(rf"\b({_MRP_AMOUNT_CHARS}{{1,5}}(?:[.,]{_MRP_AMOUNT_CHARS}{{1,2}})?)\b")


def _normalize_mrp_currency_markers(text: str) -> str:
    """Fixes common OCR mistakes on the currency marker itself, before amount extraction."""
    t = text
    t = re.sub(r"\bR5\b", "RS", t, flags=re.IGNORECASE)          # "R5 45" -> "RS 45"
    t = re.sub(r"(?<![A-Za-z])S\.", "RS.", t)                     # "S.45" -> "RS.45"
    t = t.replace("/-", "")                                       # "45/-" -> "45"
    return t


def extract_mrp(raw_text: str) -> FieldResult:
    text = _normalize_mrp_currency_markers(_clean(raw_text))

    m = _MRP_LABELED_RE.search(text)
    amount_str = m.group(1) if m else None
    if amount_str is None:
        bare = _MRP_BARE_RE.search(text)
        if not bare:
            return FieldResult(raw_text, None, False, "no price pattern found")
        amount_str = bare.group(1)

    amount_str = _map_digits(amount_str).replace(",", ".")
    try:
        amount = float(amount_str)
    except ValueError:
        return FieldResult(raw_text, None, False, "could not parse number")

    # Sanity range: reject implausible extremes as well as the plain
    # out-of-range case. 100000/99999 are common OCR-misread ceiling
    # artifacts rather than real MRPs; adjust the bounds to your catalog
    # if you sell items outside this band.
    if amount < 1 or amount >= 100000 or amount in (99999, 100000):
        return FieldResult(raw_text, None, False, f"amount {amount} out of plausible range")

    value = f"{amount:.2f}" if amount != int(amount) else f"{int(amount)}"
    return FieldResult(raw_text, f"Rs. {value}", True)


# ---------------------------------------------------------------------------
# dates — manufacturing_date / expiry_date
# ---------------------------------------------------------------------------
_DATE_FORMATS = [
    # day-month-year, various separators
    "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y", "%d.%m.%y",
    # month-year only
    "%m/%Y", "%m-%Y", "%m.%y", "%m/%y", "%m%Y",
    # ISO-ish
    "%Y-%m-%d", "%Y/%m/%d", "%Y-%m", "%Y/%m",
    # month name variants
    "%d %b %Y", "%d %B %Y", "%b %Y", "%B %Y", "%d %b %y", "%b %y",
    "%b-%Y", "%b%Y",
]
_DATE_SUBSTRING_RE = re.compile(
    r"\b\d{4}[/\-]\d{1,2}[/\-]\d{1,2}\b"                  # YYYY-MM-DD / YYYY/MM/DD
    r"|\b\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}\b"              # DD-MM-YYYY etc
    r"|\b\d{4}[/\-]\d{1,2}\b"                              # YYYY-MM
    r"|\b\d{1,2}[/\-.]\d{2,4}\b"                           # MM-YYYY / MM.YY
    r"|\b\d{6}\b"                                          # MMYYYY, no separator
    r"|\b\d{1,2}\s*[A-Za-z]{3,9}\s*\d{2,4}\b"              # DD MON YYYY
    r"|\b[A-Za-z]{3,9}[\s\-]?\d{2,4}\b"                    # MON YYYY / MON-YYYY / MONYYYY
)
_DATE_LABEL_RE = re.compile(r"\b(mfg|mfd|exp|expiry|best before|use by|bb)\b\.?:?", re.IGNORECASE)


def _try_parse(text: str) -> Optional[str]:
    for fmt in _DATE_FORMATS:
        try:
            dt = datetime.strptime(text, fmt)
            return dt.strftime("%Y-%m-%d") if "%d" in fmt else dt.strftime("%Y-%m")
        except ValueError:
            continue
    return None


def extract_date(raw_text: str, field_name: str = "date") -> FieldResult:
    text = _DATE_LABEL_RE.sub("", _clean(raw_text)).strip()

    # Try as-is first, then with dot-matrix digit confusions fixed —
    # trying the unmodified text first avoids any risk of the confusion
    # fix changing an already-correct reading.
    parsed = None
    for candidate in (text, fix_dotmatrix_confusions(text)):
        parsed = _try_parse(candidate)
        if not parsed:
            m = _DATE_SUBSTRING_RE.search(candidate)
            if m:
                parsed = _try_parse(m.group(0))
        if parsed:
            break

    if not parsed:
        return FieldResult(raw_text, None, False, f"could not parse a valid {field_name}")

    year = int(parsed[:4])
    current_year = datetime.now().year
    if not (2000 <= year <= current_year + 15):
        return FieldResult(raw_text, None, False, f"year {year} out of plausible range")

    return FieldResult(raw_text, parsed, True)


def validate_date_pair(manufacturing_date: Optional[str], expiry_date: Optional[str]) -> Tuple[bool, Optional[str]]:
    """
    Cross-field check: when BOTH dates are available (as the normalized
    'YYYY-MM-DD' / 'YYYY-MM' strings extract_date() returns), the expiry
    date must be strictly after the manufacturing date — catches OCR/field
    mix-ups like "MFG 2025" + "EXP 2024".

    This can't live inside postprocess_field() since that validates one
    field at a time; call this from pipeline.py once both fields have been
    extracted, and reject/flag both fields for review if it returns False.
    If either date is missing, there's nothing to compare — returns
    (True, None) rather than rejecting on incomplete information.
    """
    if not manufacturing_date or not expiry_date:
        return True, None
    try:
        mfg_dt = datetime.strptime(manufacturing_date, "%Y-%m-%d" if len(manufacturing_date) > 7 else "%Y-%m")
        exp_dt = datetime.strptime(expiry_date, "%Y-%m-%d" if len(expiry_date) > 7 else "%Y-%m")
    except ValueError:
        return True, None  # already-invalid strings aren't this function's job to catch

    if exp_dt <= mfg_dt:
        return False, f"expiry date {expiry_date} is not after manufacturing date {manufacturing_date}"
    return True, None


# ---------------------------------------------------------------------------
# brand / product_name
# ---------------------------------------------------------------------------
_TRADEMARK_SYMBOLS_RE = re.compile(r"[®™©]")
_SYMBOLS_ONLY_RE = re.compile(r"^[\W_]+$")

_PRODUCT_NAME_BLACKLIST = {
    "mrp", "batch", "batch no", "exp", "expiry", "mfg", "manufactured",
    "date", "net", "weight", "quantity", "net wt", "net qty",
}


def extract_brand(raw_text: str) -> FieldResult:
    text = _clean(raw_text)
    text = _TRADEMARK_SYMBOLS_RE.sub("", text).strip()
    text = _strip_trailing_punctuation(text)

    if len(text) < 2:
        return FieldResult(raw_text, None, False, "text too short")
    if _SYMBOLS_ONLY_RE.match(text):
        return FieldResult(raw_text, None, False, "OCR text is symbols/punctuation only")
    if len(re.findall(r"[A-Za-z0-9]", text)) < 2:
        return FieldResult(raw_text, None, False, "fewer than 2 alphanumeric characters — likely OCR noise")

    return FieldResult(raw_text, text, True)


def extract_product_name(raw_text: str) -> FieldResult:
    text = _clean(raw_text)
    text = _strip_trailing_punctuation(text)

    if not text or len(text) < 2:
        return FieldResult(raw_text, None, False, "text too short/empty")
    if text.lower() in _PRODUCT_NAME_BLACKLIST:
        return FieldResult(raw_text, None, False, f"OCR text is a field label ('{text}'), not a product name")

    return FieldResult(raw_text, text, True)


# ---------------------------------------------------------------------------
# Dispatcher
# ---------------------------------------------------------------------------
def postprocess_field(field_class: str, raw_text: str) -> FieldResult:
    """Routes raw OCR text to the right extractor/validator for a given YOLO class."""
    if field_class == "net_quantity":
        return extract_net_quantity(raw_text)
    if field_class == "mrp":
        return extract_mrp(raw_text)
    if field_class == "manufacturing_date":
        return extract_date(raw_text, "manufacturing date")
    if field_class == "expiry_date":
        return extract_date(raw_text, "expiry date")
    if field_class == "brand":
        return extract_brand(raw_text)
    if field_class == "product_name":
        return extract_product_name(raw_text)
    cleaned = _clean(raw_text)
    return FieldResult(raw_text, cleaned or None, bool(cleaned))