"""
field_extractor.py
-------------------
Entity recognition layer. Takes the already-extracted structured_data
(from ocr.py's regex/spatial/LLM merge) plus the raw corrected text, and
resolves it into cleanly separated entities:

    company / brand / product / variant / parent_company / address /
    phone / email / website

This is deliberately separate from ocr.py's LLM-based structured
extraction: ocr.py answers "what text is present near this label", while
this module answers "which entity does that text actually refer to" —
e.g. distinguishing a marketer's brand name from the manufacturer's legal
entity name, and attaching a known parent company where recognized.
"""

import re
from typing import Any, Dict, List, Optional

# Small seed dictionary mapping a recognized brand -> (legal entity
# fragment, parent company). Extend this as new brands are catalogued;
# unrecognized brands simply pass through with parent_company = None.
_BRAND_KNOWLEDGE = {
    "nivea": {"company": "NIVEA India Pvt. Ltd.", "parent_company": "Beiersdorf AG"},
    "dove": {"company": "Hindustan Unilever Limited", "parent_company": "Unilever"},
    "lux": {"company": "Hindustan Unilever Limited", "parent_company": "Unilever"},
    "colgate": {"company": "Colgate-Palmolive (India) Ltd.", "parent_company": "Colgate-Palmolive Company"},
    "himalaya": {"company": "The Himalaya Drug Company", "parent_company": None},
    "patanjali": {"company": "Patanjali Ayurved Ltd.", "parent_company": None},
}

_EMAIL_RE = re.compile(r"[\w.\-+]+@[\w\-]+\.[a-zA-Z]{2,}")
_URL_RE = re.compile(r"\b(?:https?://)?(?:www\.)?[\w\-]+\.(?:com|in|co\.in|net|org)\b", re.IGNORECASE)
_PHONE_RE = re.compile(r"(?:\+?91[\s-]?)?\b\d{10}\b|\b1800[\s-]?\d{2,3}[\s-]?\d{4}\b")

# Variant keywords commonly appended to a product name on FMCG labels.
_VARIANT_KEYWORDS = re.compile(
    r"\b(soft|smooth|repair|whitening|advanced|extra|classic|original|"
    r"sensitive|gold|men|women|kids|xl|lite|light|intense|deep|active)\b",
    re.IGNORECASE,
)


def extract_contact_entities(full_text: str) -> Dict[str, Optional[str]]:
    """Pulls email/phone/website candidates out of the full OCR text,
    independent of label proximity (a fallback for cases where the
    label-proximity extractor in ocr.py missed them)."""
    email_m = _EMAIL_RE.search(full_text or "")
    phone_m = _PHONE_RE.search(full_text or "")
    url_m = _URL_RE.search(full_text or "")
    return {
        "email": email_m.group(0) if email_m else None,
        "phone": phone_m.group(0) if phone_m else None,
        "website": url_m.group(0) if url_m else None,
    }


def resolve_brand_and_company(
    llm_brand: Optional[str],
    structured_data: Dict[str, Any],
) -> Dict[str, Optional[str]]:
    """
    Decides brand / company / parent_company from whatever was extracted,
    preferring known-brand knowledge when the brand is recognized.
    """
    manufacturer = structured_data.get("manufacturer")
    marketer = structured_data.get("marketer")

    brand = llm_brand or None
    if not brand or brand.upper() == "UNKNOWN":
        # Fall back to the leading distinctive word of manufacturer/marketer.
        source_name = marketer if marketer and marketer.upper() != "UNKNOWN" else manufacturer
        if source_name and source_name.upper() != "UNKNOWN":
            brand = source_name.split()[0]

    company = None
    parent_company = None
    if brand:
        known = _BRAND_KNOWLEDGE.get(brand.strip().lower())
        if known:
            company = known["company"]
            parent_company = known["parent_company"]

    if not company:
        for candidate in (marketer, manufacturer):
            if candidate and candidate.upper() != "UNKNOWN":
                company = candidate
                break

    return {
        "brand": brand,
        "company": company,
        "parent_company": parent_company,
    }


def extract_variant(product_name: Optional[str]) -> Optional[str]:
    """Pulls a variant keyword out of a product name string, e.g.
    'Soft Moisturizing Cream' -> 'Soft'. Returns None if no known variant
    keyword is present — this is intentionally conservative rather than
    guessing."""
    if not product_name or product_name.upper() == "UNKNOWN":
        return None
    m = _VARIANT_KEYWORDS.search(product_name)
    return m.group(0).title() if m else None


def extract_entities(
    llm_brand: Optional[str],
    llm_product_name: Optional[str],
    structured_data: Dict[str, Any],
    corrected_full_text: str,
) -> Dict[str, Any]:
    """
    Main entry point. Returns a flat entity dict:
        {
          "brand": ..., "company": ..., "parent_company": ...,
          "product": ..., "variant": ...,
          "address": ..., "phone": ..., "email": ..., "website": ...,
        }
    Never overwrites a field already present in structured_data from a
    more reliable spatial/regex source — only fills gaps.
    """
    brand_info = resolve_brand_and_company(llm_brand, structured_data)
    variant = extract_variant(llm_product_name)

    contacts = extract_contact_entities(corrected_full_text)
    email = structured_data.get("consumer_care") if _EMAIL_RE.match(structured_data.get("consumer_care") or "") else contacts["email"]
    phone = structured_data.get("consumer_care") if _PHONE_RE.match(structured_data.get("consumer_care") or "") else contacts["phone"]

    address = None
    for key in ("manufacturer_address",):
        val = structured_data.get(key)
        if val and val.upper() != "UNKNOWN":
            address = val
            break

    product_name = llm_product_name if llm_product_name and llm_product_name.upper() != "UNKNOWN" else None

    return {
        "brand": brand_info["brand"] or "UNKNOWN",
        "company": brand_info["company"] or "UNKNOWN",
        "parent_company": brand_info["parent_company"],
        "product": product_name or "UNKNOWN",
        "variant": variant,
        "address": address or "UNKNOWN",
        "phone": phone or "UNKNOWN",
        "email": email or "UNKNOWN",
        "website": contacts["website"] or "UNKNOWN",
    }