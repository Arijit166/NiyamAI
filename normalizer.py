"""
normalizer.py
-------------
Normalization layer. Turns raw / lightly-corrected OCR field values into
clean, structured, machine-usable values.

This module does NOT decide whether a value is valid — that's validator.py's
job. normalizer.py only reshapes text that is already present:
    - spacing / concatenation fixes ("byNIVEA" -> "by NIVEA")
    - splitting run-together ingredient lists
    - pulling structured pieces (pincode, state, street) out of a free-text
      address
    - delegating date / price / quantity normalization to postprocess.py
      (single source of truth for those formats)
    - bucketing the OCR "sections" text into semantic categories

Every normalize_* function returns:
    {
        "raw": <original text>,
        "normalized": <cleaned/structured value, or None>,
        "changed": bool,
    }
so callers (pipeline.py / json_builder.py) can always show raw vs clean.
"""

import re
from typing import Any, Dict, List, Optional

from postprocess import (
    extract_date,
    extract_mrp,
    extract_net_quantity,
    fix_dotmatrix_confusions,
)

# ---------------------------------------------------------------------------
# Generic OCR spacing / concatenation cleanup
# ---------------------------------------------------------------------------

# Known glued-word fixes seen repeatedly on FMCG/pharma labels. Keys are
# lowercase, matched case-insensitively; the replacement preserves the
# original casing of the first character where practical.
_KNOWN_GLUED_WORDS = {
    "carepromise": "care promise",
    "accordingto": "according to",
    "netquantity": "net quantity",
    "bestbefore": "best before",
    "usebefore": "use before",
    "customercare": "customer care",
    "consumercare": "consumer care",
    "madein": "made in",
    "manufacturedby": "manufactured by",
    "manufacturedfor": "manufactured for",
    "countryoforigin": "country of origin",
}

_CAMEL_CASE_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_BY_LABEL_RE = re.compile(r"\bby([A-Z][a-zA-Z]+)")
_TRAILING_DOT_NUMBER_RE = re.compile(r"(\.\d{3,})\.$")  # "...400070." -> "...400070"
_LTR_ABBR_FIX_RE = re.compile(r"\bLtd\.(?=[A-Z])")


def _fix_glued_words(text: str) -> str:
    def repl(m):
        word = m.group(0)
        fixed = _KNOWN_GLUED_WORDS.get(word.lower())
        if not fixed:
            return word
        return fixed.capitalize() if word[0].isupper() else fixed

    pattern = re.compile(
        r"\b(" + "|".join(re.escape(k) for k in _KNOWN_GLUED_WORDS) + r")\b",
        re.IGNORECASE,
    )
    return pattern.sub(repl, text)


def normalize_spacing(raw_text: str) -> Dict[str, Any]:
    """
    Fixes common OCR spacing/concatenation problems:
      - dictionary-known glued words ("carepromise" -> "care promise")
      - "byNIVEA" -> "by NIVEA"
      - CamelCase word boundaries ("AGH.Phoenix" untouched, but
        "PhoenixMarketCity" -> "Phoenix Market City")
      - "Ltd.SM" -> "Ltd. SM"
      - trailing dangling period after a number ("400070." -> "400070")
    """
    if not raw_text:
        return {"raw": raw_text, "normalized": None, "changed": False}

    text = raw_text

    text = _fix_glued_words(text)
    text = _BY_LABEL_RE.sub(lambda m: f"by {m.group(1)}", text)
    text = _LTR_ABBR_FIX_RE.sub("Ltd. ", text)
    text = _CAMEL_CASE_RE.sub(" ", text)
    text = _TRAILING_DOT_NUMBER_RE.sub(r"\1", text)
    text = re.sub(r"\s+", " ", text).strip()

    return {
        "raw": raw_text,
        "normalized": text or None,
        "changed": text.strip() != raw_text.strip(),
    }


# ---------------------------------------------------------------------------
# Address normalization
# ---------------------------------------------------------------------------

# Minimal state-name list for extraction; extend as needed.
_INDIAN_STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
    "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
    "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
    "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry",
    "Chandigarh",
]
_STATE_RE = re.compile(
    r"\b(" + "|".join(re.escape(s) for s in _INDIAN_STATES) + r")\b", re.IGNORECASE
)
_PINCODE_RE = re.compile(r"\b(\d{6})\b")

# Rough first-two-digit PIN code -> state prefix map (not exhaustive, used
# only for cross-field sanity checks in validator.py).
PIN_PREFIX_TO_STATE = {
    "11": "Delhi", "12": "Haryana", "13": "Haryana", "14": "Punjab",
    "15": "Punjab", "16": "Punjab", "17": "Himachal Pradesh",
    "18": "Jammu and Kashmir", "19": "Jammu and Kashmir",
    "20": "Uttar Pradesh", "21": "Uttar Pradesh", "22": "Uttar Pradesh",
    "23": "Uttar Pradesh", "24": "Uttar Pradesh", "25": "Uttar Pradesh",
    "26": "Uttar Pradesh", "27": "Uttar Pradesh", "28": "Uttar Pradesh",
    "30": "Rajasthan", "31": "Rajasthan", "32": "Rajasthan",
    "33": "Rajasthan", "34": "Rajasthan",
    "36": "Gujarat", "37": "Gujarat", "38": "Gujarat", "39": "Gujarat",
    "40": "Maharashtra", "41": "Maharashtra", "42": "Maharashtra",
    "43": "Maharashtra", "44": "Maharashtra",
    "45": "Madhya Pradesh", "46": "Madhya Pradesh", "47": "Madhya Pradesh",
    "48": "Madhya Pradesh",
    "49": "Chhattisgarh",
    "50": "Telangana", "51": "Telangana", "52": "Andhra Pradesh",
    "53": "Andhra Pradesh",
    "56": "Karnataka", "57": "Karnataka", "58": "Karnataka", "59": "Karnataka",
    "60": "Tamil Nadu", "61": "Tamil Nadu", "62": "Tamil Nadu",
    "63": "Tamil Nadu", "64": "Tamil Nadu",
    "67": "Kerala", "68": "Kerala", "69": "Kerala",
    "70": "West Bengal", "71": "West Bengal", "72": "West Bengal",
    "73": "West Bengal", "74": "West Bengal",
    "75": "Odisha", "76": "Odisha", "77": "Odisha",
    "78": "Assam",
    "80": "Bihar", "81": "Bihar", "82": "Bihar", "83": "Jharkhand",
    "84": "Bihar", "85": "Jharkhand",
}


def normalize_address(raw_text: str) -> Dict[str, Any]:
    """
    Cleans a raw address string and pulls out state / pincode as separate
    structured fields when present, e.g.:

        "4th Floor,AGH.Phoenix Market City,Kurla(W)Mumbai,"
        -> {
             "line": "4th Floor, AGH, Phoenix Market City, Kurla (W), Mumbai",
             "state": None,
             "pincode": None,
           }
    """
    if not raw_text:
        return {"raw": raw_text, "normalized": None, "changed": False}

    text = normalize_spacing(raw_text)["normalized"] or raw_text

    # Ensure a space after commas, add comma before a bracketed abbreviation
    # like "Kurla(W)Mumbai" -> "Kurla (W), Mumbai"
    text = re.sub(r"\(", " (", text)
    text = re.sub(r"\)(?=[A-Za-z])", ") ", text)
    text = re.sub(r",(?=\S)", ", ", text)
    text = re.sub(r"\s+", " ", text).strip(" ,")

    pin_match = _PINCODE_RE.search(text)
    pincode = pin_match.group(1) if pin_match else None

    state_match = _STATE_RE.search(text)
    state = state_match.group(1) if state_match else None

    return {
        "raw": raw_text,
        "normalized": text or None,
        "changed": text.strip() != raw_text.strip(),
        "pincode": pincode,
        "state": state,
    }


# ---------------------------------------------------------------------------
# Phone / email / website normalization
# ---------------------------------------------------------------------------

_PHONE_DIGITS_RE = re.compile(r"[+()\-.\s]")
_TOLL_FREE_RE = re.compile(r"\b1800[\s-]?\d{2,3}[\s-]?\d{4}\b")


def normalize_phone(raw_text: str) -> Dict[str, Any]:
    if not raw_text:
        return {"raw": raw_text, "normalized": None, "changed": False}

    toll_free = _TOLL_FREE_RE.search(raw_text)
    if toll_free:
        digits = re.sub(r"\D", "", toll_free.group(0))
        return {"raw": raw_text, "normalized": digits, "changed": digits != raw_text}

    digits = _PHONE_DIGITS_RE.sub("", raw_text)
    digits = re.sub(r"\D", "", digits)

    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    elif digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]

    return {
        "raw": raw_text,
        "normalized": digits or None,
        "changed": digits != re.sub(r"\D", "", raw_text or ""),
    }


def normalize_email(raw_text: str) -> Dict[str, Any]:
    if not raw_text:
        return {"raw": raw_text, "normalized": None, "changed": False}
    text = raw_text.strip().lower()
    text = text.replace(" @", "@").replace("@ ", "@")
    text = re.sub(r"\s+", "", text)
    return {"raw": raw_text, "normalized": text or None, "changed": text != raw_text}


def normalize_website(raw_text: str) -> Dict[str, Any]:
    if not raw_text:
        return {"raw": raw_text, "normalized": None, "changed": False}
    text = raw_text.strip().lower()
    text = re.sub(r"\s+", "", text)
    if text and not re.match(r"^https?://", text):
        text = "https://" + text.lstrip("/")
    return {"raw": raw_text, "normalized": text or None, "changed": text != raw_text}


# ---------------------------------------------------------------------------
# Date / price / quantity — thin wrappers over postprocess.py so there is
# one single source of truth for those formats.
# ---------------------------------------------------------------------------

def normalize_date_field(raw_text: str, field_name: str) -> Dict[str, Any]:
    result = extract_date(raw_text, field_name)
    iso = result.value
    out: Dict[str, Any] = {"raw": raw_text, "normalized": iso, "changed": bool(iso), "valid": result.valid}
    if iso:
        if len(iso) > 7:
            year, month, day = iso.split("-")
            out.update({"type": field_name, "year": int(year), "month": int(month), "day": int(day), "iso": iso})
        else:
            year, month = iso.split("-")
            out.update({"type": field_name, "year": int(year), "month": int(month), "iso": iso})
    return out


def normalize_price(raw_text: str) -> Dict[str, Any]:
    result = extract_mrp(raw_text)
    numeric = None
    if result.value:
        m = re.search(r"\d+(?:\.\d+)?", result.value)
        if m:
            numeric = float(m.group(0))
    return {
        "raw": raw_text,
        "normalized": result.value,
        "amount": numeric,
        "currency": "INR" if result.value else None,
        "changed": bool(result.value),
        "valid": result.valid,
    }


def normalize_quantity(raw_text: str) -> Dict[str, Any]:
    result = extract_net_quantity(raw_text)
    return {
        "raw": raw_text,
        "normalized": result.value,
        "changed": bool(result.value),
        "valid": result.valid,
    }


# ---------------------------------------------------------------------------
# Ingredient parsing
# ---------------------------------------------------------------------------

# A short seed dictionary of common cosmetic/FMCG INCI ingredient names,
# used to split runs of concatenated ingredient tokens where commas/spaces
# were dropped by OCR. Extend per product-category as needed (see
# get_product_ingredient_dictionary below for brand-specific extensions).
_COMMON_INGREDIENTS = [
    "Aqua", "Water", "Glycerin", "Paraffinum Liquidum", "Dimethicone",
    "Tocopheryl Acetate", "Cetearyl Alcohol", "Ceteareth-20", "Ceteareth-12",
    "Cetyl Palmitate", "Panthenol", "Coumarin", "BHT", "Parfum", "Fragrance",
    "Sodium Lauryl Sulfate", "Sodium Laureth Sulfate", "Citric Acid",
    "Sodium Chloride", "Sodium Benzoate", "Potassium Sorbate",
    "Disodium EDTA", "Stearic Acid", "Glyceryl Stearate", "PEG-100 Stearate",
    "Microcrystalline Wax", "Cera Microcristallina", "Alcohol Denat",
    "Butylene Glycol", "Propylene Glycol", "Xanthan Gum", "Carbomer",
    "Triethanolamine", "Phenoxyethanol", "Methylparaben", "Propylparaben",
    "Limonene", "Linalool", "Citronellol", "Geraniol", "Benzyl Alcohol",
    "Benzyl Salicylate", "Hexyl Cinnamal", "Niacinamide", "Aloe Barbadensis",
    "C15-19 Alkane", "Titanium Dioxide", "Zinc Oxide",
]

# Sort longest-first so multi-word names match before their shorter
# sub-strings (e.g. "Sodium Laureth Sulfate" before "Sodium Chloride").
_INGREDIENT_DICT_SORTED = sorted(_COMMON_INGREDIENTS, key=len, reverse=True)
_INGREDIENT_RE = re.compile(
    "(" + "|".join(re.escape(i) for i in _INGREDIENT_DICT_SORTED) + ")",
    re.IGNORECASE,
)


def get_product_ingredient_dictionary(brand: Optional[str]) -> List[str]:
    """Returns the base ingredient dictionary, optionally extended with
    brand-specific known ingredients. Extend this map as new brands are
    catalogued; unknown brands fall back to the common list."""
    brand_extras = {
        "nivea": ["Paraffinum Liquidum", "Cera Microcristallina", "Panthenol"],
    }
    extras = brand_extras.get((brand or "").strip().lower(), [])
    return sorted(set(_COMMON_INGREDIENTS) | set(extras), key=len, reverse=True)


def parse_ingredients(raw_text: str, brand: Optional[str] = None) -> Dict[str, Any]:
    """
    Splits a run-together ingredient string into a list, using CamelCase
    boundaries, comma/space normalization, and dictionary matching against
    known INCI ingredient names.

    "AquaGlycerinC15-19 Alkane" -> ["Aqua", "Glycerin", "C15-19 Alkane"]
    """
    if not raw_text:
        return {"raw": raw_text, "ingredients": [], "changed": False}

    text = raw_text.strip()

    dictionary = get_product_ingredient_dictionary(brand)
    pattern = re.compile(
        "(" + "|".join(re.escape(i) for i in sorted(set(dictionary), key=len, reverse=True)) + ")",
        re.IGNORECASE,
    )

    # Insert a delimiter before every dictionary match, then also split on
    # CamelCase boundaries and existing commas/semicolons as a fallback.
    spaced = pattern.sub(lambda m: f"|{m.group(1)}", text)
    spaced = _CAMEL_CASE_RE.sub("|", spaced)
    spaced = re.sub(r"[;,]", "|", spaced)

    raw_tokens = [t.strip(" .|") for t in spaced.split("|")]
    ingredients = [t for t in raw_tokens if t]

    # De-duplicate consecutive empties/near-duplicates while preserving order.
    seen = set()
    deduped = []
    for ing in ingredients:
        key = ing.lower()
        if key not in seen:
            seen.add(key)
            deduped.append(ing)

    return {
        "raw": raw_text,
        "ingredients": deduped,
        "changed": deduped != [raw_text],
    }


# ---------------------------------------------------------------------------
# Semantic sectioning
# ---------------------------------------------------------------------------

_CLAIM_KEYWORDS = re.compile(
    r"\b(dermatologically tested|clinically proven|24h|48h|hypoallergenic|"
    r"no parabens|free from|suitable for|enriched with|protects|nourishes|"
    r"care promise|years of|building on)\b",
    re.IGNORECASE,
)
_INGREDIENT_HEADER_RE = re.compile(r"\bingredients?\s*:?\b", re.IGNORECASE)
_MANUFACTURER_HEADER_RE = re.compile(
    r"\b(marketed by|manufactured by|manufactured for|marketer|manufacturer)\b",
    re.IGNORECASE,
)
_PRICING_HEADER_RE = re.compile(r"\b(mrp|m\.r\.p\.?|price)\b", re.IGNORECASE)


def build_semantic_sections(section_lines: List[str], structured_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Buckets raw OCR "sections" text (marketing copy, ingredient blocks,
    manufacturer info, etc.) into semantic categories instead of returning
    a flat, unlabeled list.
    """
    structured_data = structured_data or {}
    claims: List[str] = []
    ingredients_text: List[str] = []
    marketing_text: List[str] = []
    manufacturer_info: List[str] = []
    pricing: List[str] = []

    in_ingredients_block = False
    for line in section_lines or []:
        if not line or not line.strip():
            continue

        if _INGREDIENT_HEADER_RE.search(line):
            in_ingredients_block = True
            continue

        if in_ingredients_block:
            # Ingredient blocks typically end when a new labeled section starts.
            if _MANUFACTURER_HEADER_RE.search(line) or _PRICING_HEADER_RE.search(line):
                in_ingredients_block = False
            else:
                ingredients_text.append(line)
                continue

        if _MANUFACTURER_HEADER_RE.search(line):
            manufacturer_info.append(line)
        elif _PRICING_HEADER_RE.search(line):
            pricing.append(line)
        elif _CLAIM_KEYWORDS.search(line):
            claims.append(line)
        else:
            marketing_text.append(line)

    ingredient_list = []
    if ingredients_text:
        parsed = parse_ingredients(" ".join(ingredients_text))
        ingredient_list = parsed["ingredients"]

    return {
        "claims": claims,
        "ingredients": ingredient_list,
        "marketing_text": " ".join(marketing_text).strip(),
        "manufacturer_info": " ".join(manufacturer_info).strip() or None,
        "pricing": " ".join(pricing).strip() or None,
    }