"""
ocr.py
------
Production-grade standalone OCR pipeline combining PaddleOCR with Groq LLM 
Correction layer using environment variables from a .env file.
"""

import os
import sys

# Ensure UTF-8 output encoding for Windows terminals
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

from pathlib import Path
from dotenv import load_dotenv

# Load variables from .env file into os.environ at execution start
ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

# Disable oneDNN and PIR executor flags BEFORE paddle imports to prevent execution crashes
os.environ["FLAGS_use_onednn"] = "0"
os.environ["FLAGS_use_mkldnn"] = "0"
os.environ["PADDLE_DISABLE_ONEDNN"] = "1"
os.environ["FLAGS_enable_pir_api"] = "0"
os.environ["FLAGS_enable_pir_in_executor"] = "0"
os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"

import base64
import json
import re
import time
import cv2
import numpy as np
from datetime import datetime, timezone
from typing import Dict, List, Any, Union, Tuple, Optional

try:
    from paddleocr import PaddleOCR
except ImportError:
    print("\n[ERROR] PaddleOCR is not installed in the currently active Python environment.")
    print("Please install via: pip install paddlepaddle paddleocr\n")
    sys.exit(1)

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

try:
    import pytesseract
except ImportError:
    pytesseract = None


# ---------------------------------------------------------------------------
# Field-specific value-pattern validation (Stage 5 / Stage 7).
#
# Never trust a spatially-nearby piece of text just because it's close to a
# label. "Exp. Date" followed by "M.R.P." should never become an expiry
# date. Each field that has a predictable format gets a strict pattern;
# candidates that don't match are rejected rather than accepted. Batch
# numbers have no fixed format, so that pattern stays deliberately lenient —
# the goal there is only to reject obvious non-values (empty strings, stray
# punctuation), not to second-guess a real alphanumeric code.
# ---------------------------------------------------------------------------

FIELD_VALUE_PATTERNS: Dict[str, "re.Pattern"] = {
    "manufacturing_date": re.compile(r'\b\d{1,2}[/\-.]\d{4}\b|\b[A-Za-z]{3}\s?\d{4}\b'),
    "expiry_date": re.compile(r'\b\d{1,2}[/\-.]\d{4}\b|\b[A-Za-z]{3}\s?\d{4}\b'),
    "mrp": re.compile(r'\d+(\.\d{1,2})?'),
    "batch_number": re.compile(r'[A-Za-z0-9\-]{2,}'),
}


def validate_field_value(field_name: str, candidate_text: Optional[str]) -> Optional[str]:
    """Returns the matched substring if candidate_text fits field_name's
    expected format, else None. Fields with no registered pattern pass
    through unchanged (validation is opt-in per field)."""
    if not candidate_text:
        return None
    pattern = FIELD_VALUE_PATTERNS.get(field_name)
    if pattern is None:
        return candidate_text.strip() or None
    m = pattern.search(candidate_text)
    return m.group(0) if m else None


# ---------------------------------------------------------------------------
# Deterministic regex/label-proximity extractor.
#
# This runs on the corrected OCR text lines directly and takes PRIORITY over
# the LLM's structured extraction. Rationale: if OCR literally captured
# something (e.g. "44" sitting right under a "Batch No" label), that is a
# real, ground-truth OCR reading -- right or wrong, it should be preserved,
# not silently discarded to "UNKNOWN" by an LLM step that only sees text and
# has no way to confirm what OCR actually saw. UNKNOWN should mean "nothing
# was captured at all", not "something was captured but looked uncertain".
# ---------------------------------------------------------------------------

_BATCH_LABEL_RE = re.compile(r'\b(batch\s*no\.?|b\.?\s*no\.?|batch\s*number|lot\s*no\.?)\b', re.I)
_MFG_DATE_LABEL_RE = re.compile(r'\b(mfg\.?\s*date|mfg\.?\s*dt\.?|manufacturing\s*date|pkd\.?|packed\s*on|packing\s*date)\b', re.I)
_EXP_DATE_LABEL_RE = re.compile(r'\b(exp\.?\s*date|exp\.?\s*dt\.?|expiry\s*date|use\s*before|best\s*before)\b', re.I)
_MRP_LABEL_RE = re.compile(r'\b(mrp|m\.r\.p\.?|maximum\s*retail\s*price)\b', re.I)
_NET_QTY_RE = re.compile(r'\b\d+(\.\d+)?\s*(g|gm|gms|kg|ml|l|litre|liters?)\b', re.I)
_CONSUMER_CARE_LABEL_RE = re.compile(r'\b(consumer\s*care|customer\s*care|helpline|toll[- ]?free)\b', re.I)
_EMAIL_RE = re.compile(r'[\w.\-]+@[\w.\-]+\.\w+')
_COUNTRY_ORIGIN_LABEL_RE = re.compile(r'\b(country\s*of\s*origin|made\s*in)\b', re.I)
_MFG_LIC_LABEL_RE = re.compile(r'\b(mfg\.?\s*lic\.?\s*no\.?|manufacturing\s*licen[sc]e\s*no\.?)\b', re.I)
_SECTION_BREAK_RE = re.compile(
    r'\b(batch\s*no|mfg\.?\s*date|exp\.?\s*date|mrp|consumer\s*care|customer\s*care)\b', re.I
)
_DATE_VALUE_RE = re.compile(r'\b\d{1,2}[/\-]\d{4}\b|\b\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}\b')

# Labels whose adjacent VALUE is likely to be small, faint, dot-matrix
# printed text that base OCR commonly misses or mis-locates entirely.
_ROI_RECOVERY_LABELS = [
    ("manufacturing_date", re.compile(r'\bmfg\.?\s*date\b|\bmfg\.?\s*dt\.?\b|\bmanufacturing\s*date\b|\bpkd\.?\b', re.I)),
    ("expiry_date", re.compile(r'\bexp\.?\s*date\b|\bexp\.?\s*dt\.?\b|\bexpiry\s*date\b|\buse\s*before\b', re.I)),
    ("batch_number", re.compile(r'\bbatch\s*no\.?\b|\bb\.?\s*no\.?\b|\blot\s*no\.?\b', re.I)),
    ("mrp", re.compile(r'\bmrp\b|\bm\.r\.p\.?\b', re.I)),
]


def _extract_inline_value(line: str, match: "re.Match") -> Optional[str]:
    """Given a line and a label match on it, return whatever text sits after
    the label on the SAME line (with leading separators like ':'/'-' stripped),
    or None if the line is just the label with nothing else on it."""
    remainder = line[match.end():].lstrip(" :.-\t")
    remainder = remainder.strip()
    return remainder or None


def regex_extract_fields(lines: List[str]) -> Dict[str, str]:
    """
    Deterministic label-proximity extractor. Walks the corrected OCR lines
    in order; when a known field label is found, takes the value from the
    same line (if present after the label) or the very next line (the
    common case, since OCR usually detects a label and its value as two
    separate lines). Returns only fields it actually found something for.
    """
    fields: Dict[str, Optional[str]] = {
        "manufacturer": None,
        "manufacturer_address": None,
        "marketer": None,
        "mrp": None,
        "net_quantity": None,
        "manufacturing_date": None,
        "batch_number": None,
        "expiry_date": None,
        "consumer_care": None,
        "country_of_origin": None,
        "mfg_license_no": None,
    }

    n = len(lines)
    i = 0
    while i < n:
        line = lines[i]

        # "Manufactured ... for <marketer> by <manufacturer>" — a common
        # multi-line pattern on pharma/FMCG labels. Handled first since it
        # spans several lines and would otherwise be mis-parsed line-by-line.
        if fields["manufacturer"] is None and re.search(r"\bmanufactured\b", line, re.I):
            marketer_parts: List[str] = []
            manufacturer_parts: List[str] = []
            mode = None

            for_match = re.search(r"\bfor\b", line, re.I)
            if for_match:
                trailing = line[for_match.end():].strip(" :.-")
                if trailing:
                    marketer_parts.append(trailing)
                mode = "marketer"

            j = i + 1
            while j < n and j < i + 8:
                nxt = lines[j].strip()
                if re.match(r"^by\b", nxt, re.I):
                    trailing = re.sub(r"^by\b", "", nxt, flags=re.I).strip(" :.-")
                    if trailing:
                        manufacturer_parts.append(trailing)
                    mode = "manufacturer"
                    j += 1
                    continue
                if _SECTION_BREAK_RE.search(nxt):
                    break
                if mode == "marketer":
                    marketer_parts.append(nxt)
                elif mode == "manufacturer":
                    manufacturer_parts.append(nxt)
                else:
                    manufacturer_parts.append(nxt)
                j += 1

            if marketer_parts:
                fields["marketer"] = " ".join(marketer_parts).strip()
            if manufacturer_parts:
                fields["manufacturer"] = manufacturer_parts[0].strip()
                if len(manufacturer_parts) > 1:
                    fields["manufacturer_address"] = " ".join(manufacturer_parts[1:]).strip()
            i = j
            continue

        matched = False
        for field_name, label_re, value_re in (
            ("batch_number", _BATCH_LABEL_RE, None),
            ("manufacturing_date", _MFG_DATE_LABEL_RE, _DATE_VALUE_RE),
            ("expiry_date", _EXP_DATE_LABEL_RE, _DATE_VALUE_RE),
            ("mrp", _MRP_LABEL_RE, None),
            ("country_of_origin", _COUNTRY_ORIGIN_LABEL_RE, None),
            ("mfg_license_no", _MFG_LIC_LABEL_RE, None),
        ):
            if fields[field_name] is not None:
                continue
            m = label_re.search(line)
            if not m:
                continue

            val = _extract_inline_value(line, m)
            if not val and i + 1 < n:
                candidate = lines[i + 1].strip()
                # Don't swallow the NEXT label as if it were this field's value.
                if not _SECTION_BREAK_RE.search(candidate):
                    val = candidate
                    i += 1

            if val and value_re is not None:
                date_m = value_re.search(val)
                val = date_m.group(0) if date_m else val

            fields[field_name] = val
            matched = True
            break

        if matched:
            i += 1
            continue

        if fields["net_quantity"] is None:
            m = _NET_QTY_RE.search(line)
            if m:
                fields["net_quantity"] = m.group(0).strip()
                i += 1
                continue

        if fields["consumer_care"] is None:
            email_m = _EMAIL_RE.search(line)
            if email_m:
                fields["consumer_care"] = email_m.group(0)
                i += 1
                continue
            if _CONSUMER_CARE_LABEL_RE.search(line):
                m = _CONSUMER_CARE_LABEL_RE.search(line)
                val = _extract_inline_value(line, m)
                if not val and i + 1 < n:
                    val = lines[i + 1].strip()
                    i += 1
                fields["consumer_care"] = val
                i += 1
                continue

        i += 1

    return {k: v for k, v in fields.items() if v}


class LLMCorrector:
    """
    Multimodal/Text LLM Correction Layer using credentials loaded from environment variables.
    Compatible with Groq, OpenAI, Google Gemini, and OpenRouter endpoints.
    """
    def __init__(
        self, 
        api_key: Optional[str] = None, 
        model: Optional[str] = None, 
        base_url: Optional[str] = None
    ):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY") or os.getenv("GROQ_API_KEY")
        self.base_url = base_url or os.getenv("OPENAI_BASE_URL")
        self.model = model or os.getenv("LLM_MODEL", "qwen/qwen3.6-27b")
        self.client = None

        if OpenAI and self.api_key:
            self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)

    def encode_image_to_base64(self, image: np.ndarray, max_dim: int = 1600, jpeg_quality: int = 88) -> str:
        """
        Converts an OpenCV BGR image matrix to a base64 encoded JPEG string.
        Downscales large images first so the payload stays well under Groq's
        20MB per-request limit and keeps token/latency cost down (each image
        counts as ~2048 input tokens regardless of resolution, so there's no
        upside to sending a huge image).
        """
        h, w = image.shape[:2]
        longest = max(h, w)
        if longest > max_dim:
            scale = max_dim / float(longest)
            image = cv2.resize(image, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)

        success, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality])
        if not success:
            raise ValueError("Failed to encode image to JPEG format.")
        return base64.b64encode(buffer).decode('utf-8')

    def parse_json_response(self, content_str: str) -> Dict[str, Any]:
        """Safely parses JSON from string, handling reasoning/thinking blocks, markdown, and truncations."""
        if not content_str:
            return {}
        
        # Strip reasoning/thinking tags (e.g. <think> ... </think>)
        content_clean = re.sub(r'<think>.*?</think>', '', content_str, flags=re.DOTALL).strip()

        # 1. Direct JSON parse
        try:
            return json.loads(content_clean)
        except Exception:
            pass

        # 2. Extract from ```json ... ``` codeblock
        json_match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content_clean, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except Exception:
                pass

        # 3. Extract outer { ... }
        brace_match = re.search(r'(\{.*\})', content_clean, re.DOTALL)
        if brace_match:
            try:
                return json.loads(brace_match.group(1))
            except Exception:
                pass

        # 4. Partial/Truncated JSON recovery
        partial_match = re.search(r'(\{.*)', content_clean, re.DOTALL)
        if partial_match:
            partial_json = partial_match.group(1).strip()
            if partial_json.count('"') % 2 != 0:
                partial_json += '"'
            open_braces = partial_json.count('{') - partial_json.count('}')
            open_brackets = partial_json.count('[') - partial_json.count(']')
            partial_json += ']' * max(0, open_brackets) + '}' * max(0, open_braces)
            try:
                return json.loads(partial_json)
            except Exception:
                pass

        return {}

    def correct_all_detected_text(
        self,
        image: np.ndarray,
        detections: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        STAGE 1 (image-assisted spelling correction, scoped to text OCR
        already detected — never invents new fields).

        IMPORTANT: this now runs on EVERY detected line, not just OCR's own
        low_confidence flag. That flag reflects PaddleOCR's character-level
        certainty, not whether the RESULT is a correctly spelled real word —
        "lohnee Pharmacenticals" can come back from OCR at decent confidence
        while still being garbled. Spelling correction needs to be judged on
        the text itself, so every line gets a chance to be corrected.

        Returns a list of per-line correction records:
            {
                "ocr_text": <original>,
                "corrected_text": <best reading>,
                "changed": bool,
                "reason": <category string>,
                "confidence": "high" | "medium" | "low",
            }
        """
        if not self.client or not detections:
            return []

        items_payload = [
            {"ocr_text": d["clean_text"], "ocr_confidence": d.get("confidence")}
            for d in detections
            if d.get("clean_text")
        ]
        if not items_payload:
            return []

        system_prompt = (
            "You are an OCR spelling-correction assistant for product/commodity labels.\n\n"
            "You are given a LIST of OCR-detected text lines plus the source label image "
            "for visual reference. For EACH line, decide whether it needs correction.\n\n"
            "CORE RULE: Correct ONLY obvious OCR character-substitution errors — things "
            "like O<->0, l<->I, m<->rn, S<->5, merged/split spacing, punctuation, and "
            "expansion of a clearly-recognizable abbreviation fragment. Never infer, "
            "reconstruct, or complete a value that isn't already legible in the OCR text. "
            "If a value is not explicitly, visibly readable in the image, return it "
            "UNCHANGED with confidence \"low\" — do not guess.\n\n"
            "WHAT COUNTS AS A VALID CORRECTION (do these confidently):\n"
            "- Character-level OCR misreads of the SAME word (e.g. 'lohnee' -> 'Johnlee', "
            "'Pharmacenticals' -> 'Pharmaceuticals', 'Unted' -> 'United').\n"
            "- Common packaging abbreviation expansions where the OCR text is a recognizable "
            "fragment of it (e.g. 'Mig lN' -> 'Mfg. Lic. No', 'Mig.Dale' -> 'Mfg. Date').\n"
            "- Spacing/merge fixes where letters were run together or split incorrectly "
            "(e.g. 'Industrial ParkIV' -> 'Industrial Park IV').\n"
            "- Garbled but clearly reconstructable strings, like a merged email address, "
            "where the surrounding characters make the correct reading unambiguous.\n\n"
            "WHAT IS NOT A VALID CORRECTION (never do these):\n"
            "- Do NOT substitute a completely different proper noun (person name, company "
            "name, city/place name) just because it 'sounds plausible' or is a common name "
            "for that region. Only correct a proper noun if you can visually confirm the "
            "specific characters in the image clearly enough to be confident — otherwise "
            "leave it as the original OCR text and mark confidence \"low\". Example: OCR "
            "'Handwar' should stay 'Handwar' unless you can clearly read every character "
            "confirming a different spelling — do not 'fix' it to a different real city name.\n"
            "- Do NOT add any word, number, date, or field that was not already present in "
            "the OCR text line. You are correcting existing text, not adding new text.\n"
            "- For CODES AND NUMBERS specifically (batch numbers, license numbers, dates, "
            "MRP): only correct individual character-level misreads while keeping the exact "
            "same digit/character count (e.g. 'O' -> '0' within a code you can otherwise "
            "fully read). Do NOT reconstruct, extend, or complete a short/partial numeric "
            "fragment into what you believe the full code should be — a bare fragment like "
            "'44' next to a 'Batch No' label is NOT a batch number unless you can read the "
            "complete code; leave it unchanged with confidence \"low\" instead.\n"
            "- Do NOT guess a full value from a fragment (e.g. don't turn '44' into a full "

            "date or batch number — that's fabrication, not correction).\n\n"
            "For EVERY input line, output one entry (even if unchanged):\n"
            "Output JSON ONLY: {\"corrections\": [\n"
            "  {\"ocr_text\": <copied exactly from input>, \"corrected_text\": <your best "
            "reading; identical to ocr_text if no correction needed or you're not sure>, "
            "\"changed\": <true/false>, \"reason\": <short category, e.g. "
            "\"character misread\", \"abbreviation expansion\", \"spacing fix\", "
            "\"unchanged - already correct\", \"unchanged - not visually certain\">, "
            "\"confidence\": \"high\"|\"medium\"|\"low\"}\n"
            "]}\n"
        )

        user_text = f"OCR-detected lines:\n{json.dumps(items_payload, ensure_ascii=False)}"

        try:
            image_b64 = self.encode_image_to_base64(image)
            user_content = [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
            ]
        except Exception as e:
            print(f"  [LLM Warning] Failed to encode image for correction stage: {e}")
            return []

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
                temperature=0.0,
                max_tokens=800,
                response_format={"type": "json_object"},
                reasoning_effort="none",
                extra_body={"reasoning_format": "hidden"},
            )
            content = response.choices[0].message.content
            parsed = self.parse_json_response(content)
            corrections = parsed.get("corrections", [])
            return [c for c in corrections if isinstance(c, dict) and "ocr_text" in c]
        except Exception as e:
            print(f"  [LLM Error] Spelling correction stage failed: {e}")
            return []

    def extract_structured_fields(self, corrected_text: str) -> Dict[str, Any]:
        """
        STAGE 2 (text-only, NO image access): extracts structured Legal
        Metrology fields purely from the already-corrected OCR text. Because
        this call has no image, the model has zero opportunity to "read" a
        field off the picture that OCR never captured — it can only work
        with what's actually in corrected_text. Missing fields are forced
        to "UNKNOWN" rather than guessed.
        """
        if not self.client or not corrected_text.strip():
            return {}

        system_prompt = (
            "You are a structured-data extractor for Indian packaged-commodity labels "
            "(Legal Metrology Rules). You are given ONLY plain OCR-corrected text — you "
            "have NO access to any image.\n\n"
            "IMPORTANT: some lines may be wrapped like [UNCERTAIN: some text]. This marks "
            "text that could NOT be reliably corrected or verified. Treat the content inside "
            "[UNCERTAIN: ...] as UNRELIABLE and effectively ABSENT — never use it to populate "
            "a field, even if it sits directly next to a relevant label (e.g. a marked "
            "fragment under 'Batch No' is NOT a valid batch number — treat that field as "
            "not present in the text at all).\n\n"
            "STRICT RULES:\n"
            "1. Extract a field's value ONLY if it is explicitly present, in some form, "
            "in the RELIABLE (non-bracketed) part of the given text.\n"
            "2. If a field's value is not present in reliable text, set it to exactly "
            "\"UNKNOWN\". NEVER guess, infer, autocomplete, or fabricate a value.\n"
            "3. Do not use outside/typical knowledge of label formats to fill gaps.\n"
            "4. BRAND: if there is no separately labeled brand/trade name, use the "
            "manufacturer/company name (or its distinctive leading word — e.g. 'Johnlee' "
            "from 'Johnlee Pharmaceuticals Pvt. Ltd.') as the brand. Do not return UNKNOWN "
            "for brand merely because there's no field explicitly labeled 'Brand:' — the "
            "company name commonly serves as the brand on these labels. Only return UNKNOWN "
            "for brand if no company/manufacturer name is present in reliable text at all.\n"
            "5. PRODUCT NAME: this is the specific item/product name (e.g. a medicine or "
            "product line name), which is a DIFFERENT thing from the company name. If no "
            "such item-level name is present in reliable text, correctly return UNKNOWN for "
            "product_name even if brand/manufacturer is known.\n"
            "6. Output JSON ONLY with keys: brand, product_name, sections, structured_data.\n"
            "structured_data must contain exactly these keys: manufacturer, "
            "manufacturer_address, marketer, mrp, net_quantity, manufacturing_date, "
            "batch_number, expiry_date, consumer_care, country_of_origin, "
            "mfg_license_no — each set to the extracted value or \"UNKNOWN\". "
            "'marketer' is the company the product is made FOR (if the text distinguishes "
            "'manufactured for X by Y', X is marketer and Y is manufacturer).\n"
        )

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"OCR-corrected text:\n{corrected_text}"},
                ],
                temperature=0.0,
                max_tokens=800,
                response_format={"type": "json_object"},
                reasoning_effort="none",
                extra_body={"reasoning_format": "hidden"},
            )
            content = response.choices[0].message.content
            return self.parse_json_response(content)
        except Exception as e:
            print(f"  [LLM Error] Structured extraction stage failed: {e}")
            return {}

    def extract_field_from_crop(
        self,
        image: np.ndarray,
        field_class: str,
        ocr_text: str,
    ) -> Optional[str]:
        """
        Vision-assisted single-field extraction on an already-cropped YOLO
        ROI. Unlike extract_structured_fields (text-only, whole page), this
        sends the SPECIFIC crop image alongside whatever OCR text was
        recovered from it, so the LLM can recover a value OCR partially or
        fully missed within that small region — without ever seeing the
        rest of the label, so it can't cross-contaminate fields.

        Same anti-hallucination contract as the rest of this file: return
        None (never a guess) if the value isn't visibly, legibly present.
        """
        if not self.client:
            return None

        field_hints = {
            "manufacturing_date": "a manufacturing/packing date (e.g. MFG DATE, PKD)",
            "expiry_date": "an expiry/best-before date (e.g. EXP DATE, USE BY)",
            "batch_number": "a batch or lot number",
            "mrp": "a Maximum Retail Price (MRP), a currency amount",
            "net_quantity": "a net quantity/weight (e.g. 500g, 1L)",
            "manufacturer_name": "a manufacturer/company name",
            "manufacturer_address": "a manufacturer's postal address",
            "country_of_origin": "a country of origin",
        }
        hint = field_hints.get(field_class, f"the value for '{field_class}'")

        system_prompt = (
            f"You are reading a small cropped region from a product label. "
            f"This crop should contain {hint}.\n\n"
            "OCR of this exact crop returned:\n"
            f"\"{ocr_text or '(OCR found nothing readable)'}\"\n\n"
            "Look at the image and read the value yourself. Use OCR text as a "
            "hint, but trust your own visual reading over it if they differ.\n\n"
            "STRICT RULES:\n"
            "- Return ONLY the value itself, nothing else (no label word, no "
            "explanation).\n"
            "- If the value is not clearly, visibly legible in the image, "
            "return exactly UNKNOWN. Do not guess, infer, or complete a "
            "partial/faint value.\n"
            "- Do not invent digits or characters you cannot actually see.\n\n"
            "Output JSON ONLY: {\"value\": <the text you read, or \"UNKNOWN\">}"
        )

        try:
            image_b64 = self.encode_image_to_base64(image)
        except Exception as e:
            print(f"  [LLM Warning] Failed to encode crop for {field_class}: {e}")
            return None

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": [
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}},
                    ]},
                ],
                temperature=0.0,
                max_tokens=200,
                response_format={"type": "json_object"},
                reasoning_effort="none",
                extra_body={"reasoning_format": "hidden"},
            )
            content = response.choices[0].message.content
            parsed = self.parse_json_response(content)
            val = parsed.get("value")
            if isinstance(val, str) and val.strip() and val.strip().upper() != "UNKNOWN":
                return val.strip()
            return None
        except Exception as e:
            print(f"  [LLM Error] Crop extraction failed for {field_class}: {e}")
            return None

    def build_reliable_output(
        self,
        image: np.ndarray,
        detections: List[Dict[str, Any]],
        spatial_fields: Optional[Dict[str, Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        Orchestrates the full hallucination-resistant pipeline:

            OCR detections (with confidence)
                |
                v
            LLM proposes a correction for EVERY line (image-assisted),
            each tagged with a reason + confidence; proper nouns are only
            changed if visually certain
                |
                v
            reassemble corrected_full_text programmatically (not LLM-decided)
                |
                v
            "corrections" audit list built from every line actually changed
                |
                v
            LLM extracts structured fields from TEXT ONLY, UNKNOWN if absent
                |
                v
            uncertain_or_flagged_text auto-populated for low-confidence
            corrections and missing structured fields
        """
        if not self.client:
            print("  [LLM Warning] API key or client not configured. Spelling correction and "
                  "text-only extraction will be skipped, but spatial/regex field capture still runs.")
            lines = [d["clean_text"] for d in detections if d.get("clean_text")]
            raw_full_text = "\n".join(lines)

            regex_fields = regex_extract_fields(lines)
            spatial_fields = spatial_fields or {}
            all_field_keys = set(spatial_fields) | set(regex_fields) | {
                "manufacturer", "manufacturer_address", "marketer", "mrp",
                "net_quantity", "manufacturing_date", "batch_number",
                "expiry_date", "consumer_care", "country_of_origin", "mfg_license_no",
            }
            structured_data: Dict[str, Any] = {}
            field_sources: Dict[str, str] = {}
            uncertain_flagged: List[Dict[str, Any]] = []
            for field in sorted(all_field_keys):
                spatial_entry = spatial_fields.get(field)
                regex_val = regex_fields.get(field)
                if spatial_entry and spatial_entry.get("value"):
                    structured_data[field] = spatial_entry["value"]
                    field_sources[field] = spatial_entry.get("source", "spatial")
                elif regex_val:
                    structured_data[field] = regex_val
                    field_sources[field] = "regex_label_proximity"
                else:
                    structured_data[field] = "UNKNOWN"
                    field_sources[field] = "none"
                    uncertain_flagged.append({
                        "ocr_text": None, "llm_text": None, "field": field,
                        "reason": "Not detected anywhere in OCR text; not guessed "
                                  "(LLM correction unavailable — deterministic capture only)",
                    })

            return {
                "corrected_full_text": raw_full_text,
                "sections": [],
                "structured_data": structured_data,
                "field_sources": field_sources,
                "corrections": [],
                "uncertain_or_flagged_text": uncertain_flagged,
                "correction_applied": False,
                "error": "LLM client unavailable or missing OPENAI_API_KEY/GROQ_API_KEY in .env",
            }

        if not detections:
            return {
                "corrected_full_text": "",
                "sections": [],
                "structured_data": {},
                "field_sources": {},
                "corrections": [],
                "uncertain_or_flagged_text": [],
                "correction_applied": False,
                "error": "No text detected by OCR to refine.",
            }

        correction_records = self.correct_all_detected_text(image, detections)
        corrections_map = {c["ocr_text"]: c for c in correction_records}

        corrections_log: List[Dict[str, Any]] = []
        uncertain_flagged: List[Dict[str, Any]] = []
        final_lines: List[str] = []       # clean text, shown to the user
        stage2_lines: List[str] = []      # same text, but unresolved lines get
                                           # wrapped in [UNCERTAIN: ...] so Stage 2
                                           # structurally cannot mistake an unresolved
                                           # fragment (e.g. a bare "44") for a real
                                           # field value just because it sits near a
                                           # relevant label like "Batch No".

        for d in detections:
            ocr_text = d.get("clean_text", "")
            if not ocr_text:
                continue

            record = corrections_map.get(ocr_text)

            if not record:
                # LLM didn't return an entry for this line (e.g. call failed) —
                # keep the raw OCR text untouched rather than dropping it.
                final_lines.append(ocr_text)
                if d.get("low_confidence"):
                    stage2_lines.append(f"[UNCERTAIN: {ocr_text}]")
                    uncertain_flagged.append({
                        "ocr_text": ocr_text,
                        "llm_text": None,
                        "confidence": d.get("confidence"),
                        "reason": "Low OCR confidence; no correction available",
                    })
                else:
                    stage2_lines.append(ocr_text)
                continue

            corrected_text = record.get("corrected_text", ocr_text)
            changed = bool(record.get("changed")) and corrected_text.strip() != ocr_text.strip()
            llm_confidence = record.get("confidence", "low")

            display_text = corrected_text if changed else ocr_text
            final_lines.append(display_text)

            if changed:
                corrections_log.append({
                    "original": ocr_text,
                    "corrected": corrected_text,
                    "reason": record.get("reason", "spelling correction"),
                    "confidence": llm_confidence,
                })
                if llm_confidence == "low":
                    # Corrected, but the LLM itself wasn't confident — don't let
                    # Stage 2 treat this as solid, but still show the attempted
                    # correction to the user for manual review.
                    stage2_lines.append(f"[UNCERTAIN: {display_text}]")
                    uncertain_flagged.append({
                        "ocr_text": ocr_text,
                        "llm_text": corrected_text,
                        "confidence": d.get("confidence"),
                        "reason": "Correction applied but LLM marked it low-confidence — verify manually",
                    })
                else:
                    stage2_lines.append(display_text)
            elif d.get("low_confidence"):
                stage2_lines.append(f"[UNCERTAIN: {display_text}]")
                uncertain_flagged.append({
                    "ocr_text": ocr_text,
                    "llm_text": None,
                    "confidence": d.get("confidence"),
                    "reason": record.get("reason", "Low OCR confidence; LLM was not certain enough to correct"),
                })
            else:
                stage2_lines.append(display_text)

        corrected_full_text = "\n".join(final_lines)
        stage2_input_text = "\n".join(stage2_lines)

        structured = self.extract_structured_fields(stage2_input_text)

        # Deterministic pass over the CLEAN corrected lines (not the
        # [UNCERTAIN: ...]-marked version) — this deliberately CAN see
        # unresolved fragments like a bare "44" next to "Batch No", because
        # unlike the LLM, a plain regex match doesn't "decide" to discard it;
        # it just reports what's literally there. That's the point: OCR
        # capturing something (even an uncertain fragment) is different from
        # OCR capturing nothing, and only the latter should ever become
        # "UNKNOWN".
        regex_fields = regex_extract_fields(final_lines)
        spatial_fields = spatial_fields or {}

        # Merge priority (highest wins):
        #   1. spatial_fields  — bbox-proximity matched AND pattern-validated
        #      (from spatial_extract_labeled_fields / ROI re-OCR). Most
        #      reliable: geometry-grounded, format-checked.
        #   2. regex_fields    — literal label-proximity text capture. Still
        #      a real OCR reading, just not geometrically or format verified.
        #   3. llm_structured_data — text-only fallback, only used when
        #      nothing more reliable found anything at all.
        llm_structured_data = structured.get("structured_data", {})
        all_field_keys = (
            set(spatial_fields) | set(regex_fields) | set(llm_structured_data) | {
                "manufacturer", "manufacturer_address", "marketer", "mrp",
                "net_quantity", "manufacturing_date", "batch_number",
                "expiry_date", "consumer_care", "country_of_origin", "mfg_license_no",
            }
        )

        structured_data: Dict[str, Any] = {}
        field_sources: Dict[str, str] = {}
        for field in sorted(all_field_keys):
            spatial_entry = spatial_fields.get(field)
            regex_val = regex_fields.get(field)
            llm_val = llm_structured_data.get(field)

            if spatial_entry and spatial_entry.get("value"):
                structured_data[field] = spatial_entry["value"]
                field_sources[field] = spatial_entry.get("source", "spatial")
            elif regex_val:
                structured_data[field] = regex_val
                field_sources[field] = "regex_label_proximity"
            elif isinstance(llm_val, str) and llm_val.strip().upper() != "UNKNOWN" and llm_val.strip():
                structured_data[field] = llm_val
                field_sources[field] = "llm_text_extraction"
            else:
                structured_data[field] = "UNKNOWN"
                field_sources[field] = "none"

            if structured_data[field] == "UNKNOWN":
                uncertain_flagged.append({
                    "ocr_text": None,
                    "llm_text": None,
                    "field": field,
                    "reason": "Not detected anywhere in OCR text; not guessed",
                })

        return {
            "brand": structured.get("brand", ""),
            "product_name": structured.get("product_name", ""),
            "corrected_full_text": corrected_full_text,
            "sections": structured.get("sections", []),
            "structured_data": structured_data,
            "field_sources": field_sources,
            "corrections": corrections_log,
            "uncertain_or_flagged_text": uncertain_flagged,
            "correction_applied": True,
        }



class LabelOCRProcessor:
    def __init__(
        self, 
        use_angle_cls: bool = True, 
        lang: str = "en",
        min_confidence: float = 0.30,
        low_confidence_threshold: float = 0.60,
        min_width_px: int = 8,
        min_height_px: int = 6,
        line_threshold_factor: float = 0.65,
        llm_model: str = "qwen/qwen3.6-27b"
    ):
        self.min_confidence = min_confidence
        self.low_confidence_threshold = low_confidence_threshold
        self.min_width_px = min_width_px
        self.min_height_px = min_height_px
        self.line_threshold_factor = line_threshold_factor

        try:
            self.ocr = PaddleOCR(
                text_detection_model_name="PP-OCRv4_mobile_det",
                text_recognition_model_name="en_PP-OCRv4_mobile_rec",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=use_angle_cls,
            )
        except Exception:
            try:
                self.ocr = PaddleOCR(use_textline_orientation=use_angle_cls, lang=lang)
            except Exception:
                self.ocr = PaddleOCR(lang=lang)

        self.llm_corrector = LLMCorrector(model=llm_model)

    @staticmethod
    def _bbox_bounds(bbox: List[List[int]]) -> Tuple[int, int, int, int]:
        xs = [pt[0] for pt in bbox]
        ys = [pt[1] for pt in bbox]
        return min(xs), min(ys), max(xs), max(ys)

    def find_value_by_spatial_proximity(
        self,
        detections: List[Dict[str, Any]],
        label_idx: int,
        max_y_offset: int = 40,
        max_x_gap: int = 350,
    ) -> Optional[Dict[str, Any]]:
        """
        STAGE 6 — spatial association by bounding box, not list/reading order.
        Finds the closest detection sitting to the RIGHT of the label and at
        roughly the same vertical height, within a bounded window. This is
        what prevents "Exp. Date" from accidentally picking up "M.R.P." as
        its value just because that's what came next in the detection list —
        list order can be wrong; box geometry is ground truth.
        """
        label = detections[label_idx]
        label_bbox = label.get("bbox")
        if not label_bbox:
            return None

        lx1, ly1, lx2, ly2 = self._bbox_bounds(label_bbox)
        label_y_center = (ly1 + ly2) / 2.0
        label_height = max(1, ly2 - ly1)
        y_threshold = max(max_y_offset, label_height * 1.5)

        best = None
        best_gap = None
        for i, d in enumerate(detections):
            if i == label_idx:
                continue
            bbox = d.get("bbox")
            if not bbox:
                continue
            dx1, dy1, dx2, dy2 = self._bbox_bounds(bbox)
            d_y_center = (dy1 + dy2) / 2.0

            if dx1 < lx2 - 5:  # must sit to the right of the label (small overlap tolerance)
                continue
            if abs(d_y_center - label_y_center) > y_threshold:
                continue
            gap = dx1 - lx2
            if gap > max_x_gap:
                continue
            if best is None or gap < best_gap:
                best, best_gap = d, gap

        return best

    @staticmethod
    def enhance_roi_variants(roi: np.ndarray) -> List[np.ndarray]:
        """
        Generates several enhanced versions of a small ROI crop, since
        dot-matrix text responds differently depending on print quality.
        Order matters: cheapest/most-reliable first, since callers stop at
        the first variant whose OCR result validates against the expected
        field pattern.
        """
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY) if roi.ndim == 3 else roi.copy()
        variants = []

        # Variant A: equalize -> 3x upscale -> Otsu threshold
        v1 = cv2.equalizeHist(gray)
        v1 = cv2.resize(v1, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        _, v1 = cv2.threshold(v1, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        variants.append(v1)

        # Variant B: CLAHE -> 3x upscale -> adaptive threshold (handles
        # uneven lighting across the crop better than a single global Otsu)
        clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
        v2 = clahe.apply(gray)
        v2 = cv2.resize(v2, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        v2 = cv2.GaussianBlur(v2, (3, 3), 0)
        v2 = cv2.adaptiveThreshold(
            v2, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
        )
        variants.append(v2)

        # Variant C: 3x upscale -> unsharp mask (helps faint, non-thresholded
        # dot-matrix impressions where binarization loses too much detail)
        v3 = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
        blurred = cv2.GaussianBlur(v3, (0, 0), sigmaX=2)
        v3 = cv2.addWeighted(v3, 1.6, blurred, -0.6, 0)
        variants.append(v3)

        return variants

    def _ocr_roi(self, roi_img: np.ndarray) -> str:
        """Runs the main OCR engine (PaddleOCR) on a small cropped/enhanced
        region and returns the joined recognized text."""
        if hasattr(self.ocr, "predict"):
            res = self.ocr.predict(roi_img)
        else:
            res = self.ocr.ocr(roi_img)

        texts: List[str] = []
        if res:
            for page in res:
                if isinstance(page, list):
                    for line in page:
                        if not line or len(line) < 2:
                            continue
                        text_info = line[1]
                        t = text_info[0] if isinstance(text_info, (list, tuple)) else str(text_info)
                        if t:
                            texts.append(str(t))
                elif isinstance(page, dict):
                    rec_texts = page.get("rec_texts", page.get("rec_text", []))
                    texts.extend(str(t) for t in rec_texts if t)
        return " ".join(texts).strip()

    @staticmethod
    def _ocr_roi_tesseract(roi_img: np.ndarray) -> str:
        """Fallback engine for short, single-line fields (dates, batch
        codes, MRP) where PaddleOCR's ROI pass didn't produce a value that
        matched the expected pattern. psm 7 = treat the image as a single
        text line, which fits these small cropped fields well."""
        if pytesseract is None:
            return ""
        try:
            return pytesseract.image_to_string(
                roi_img, config="--psm 7"
            ).strip()
        except Exception:
            return ""

    def recover_value_multi_engine(
        self,
        image: np.ndarray,
        label_bbox: List[List[int]],
        field_name: str,
    ) -> Optional[Tuple[str, str]]:
        """
        STAGE 3/4/9 — crop the region to the right of a label, try several
        preprocessing variants through PaddleOCR, then fall back to
        Tesseract if none validate. Returns (value, source) for the FIRST
        candidate that passes validate_field_value for this field — never
        returns an unvalidated guess.
        """
        h, w = image.shape[:2]
        x1, y1, x2, y2 = self._bbox_bounds(label_bbox)
        box_h = max(1, y2 - y1)

        roi_x1 = max(0, x2)
        roi_x2 = min(w, x2 + 300)
        roi_y1 = max(0, y1 - int(box_h * 0.5))
        roi_y2 = min(h, y2 + int(box_h * 0.5))

        if roi_x2 <= roi_x1 or roi_y2 <= roi_y1:
            return None

        roi = image[roi_y1:roi_y2, roi_x1:roi_x2]
        if roi.size == 0:
            return None

        try:
            variants = self.enhance_roi_variants(roi)
        except Exception as e:
            print(f"  [ROI OCR Warning] Enhancement failed for {field_name}: {e}")
            return None

        # Try PaddleOCR on each preprocessing variant, first validated wins.
        for i, variant in enumerate(variants):
            try:
                text = self._ocr_roi(variant)
            except Exception as e:
                print(f"  [ROI OCR Warning] PaddleOCR ROI pass {i} failed for {field_name}: {e}")
                continue
            validated = validate_field_value(field_name, text)
            if validated:
                return validated, f"paddle_roi_variant_{i}"

        # None of the Paddle variants validated — fall back to Tesseract,
        # which is often stronger on short, single-line dot-matrix text.
        if pytesseract is not None:
            for i, variant in enumerate(variants):
                text = self._ocr_roi_tesseract(variant)
                validated = validate_field_value(field_name, text)
                if validated:
                    return validated, f"tesseract_variant_{i}"

        return None

    def spatial_extract_labeled_fields(
        self,
        image: np.ndarray,
        detections: List[Dict[str, Any]],
    ) -> Tuple[Dict[str, Dict[str, Any]], List[Tuple[int, Dict[str, Any]]]]:
        """
        Full pipeline for the fields most prone to dot-matrix OCR failure
        (manufacturing_date, expiry_date, batch_number, mrp):

            1. Spatial bbox proximity (not list order) to find a candidate
               value already detected by the base OCR pass.
            2. Validate that candidate against the field's expected pattern
               — reject silently rather than accept a wrong-field value.
            3. If nothing validates, run a focused multi-variant,
               multi-engine ROI re-OCR pass (PaddleOCR -> Tesseract) on the
               region beside the label.
            4. Only accept a value that passes validation. Never inject an
               unvalidated guess.

        Returns:
            (fields, splice_list)
            fields: {field_name: {"value": str, "source": str}}
            splice_list: [(insert_after_index, new_detection_dict), ...] for
                         any value recovered via ROI re-OCR, so it shows up
                         in the visible detections/corrected text too.
        """
        if not detections:
            return {}, []

        fields: Dict[str, Dict[str, Any]] = {}
        splice_list: List[Tuple[int, Dict[str, Any]]] = []

        for idx, d in enumerate(detections):
            text = d.get("clean_text", "")
            bbox = d.get("bbox")
            if not bbox or not text:
                continue

            field_name = None
            for name, pat in _ROI_RECOVERY_LABELS:
                if pat.search(text):
                    field_name = name
                    break
            if not field_name or field_name in fields:
                continue

            # Step 1 + 2: spatial candidate, pattern-validated.
            spatial_match = self.find_value_by_spatial_proximity(detections, idx)
            if spatial_match:
                validated = validate_field_value(field_name, spatial_match.get("clean_text", ""))
                if validated:
                    fields[field_name] = {"value": validated, "source": "ocr_spatial"}
                    continue
                else:
                    print(
                        f"  [Pattern Validation] Rejected '{spatial_match.get('clean_text')}' "
                        f"as {field_name} near '{text}' — doesn't match expected format."
                    )

            # Step 3 + 4: multi-variant, multi-engine ROI recovery.
            recovered = self.recover_value_multi_engine(image, bbox, field_name)
            if recovered:
                value, source = recovered
                fields[field_name] = {"value": value, "source": source}
                print(f"  [ROI OCR] Recovered {field_name} near '{text}': '{value}' (via {source})")

                x1, y1, x2, y2 = self._bbox_bounds(bbox)
                splice_list.append((idx, {
                    "bbox": [[x2, y1], [x2 + 200, y1], [x2 + 200, y2], [x2, y2]],
                    "raw_text": value,
                    "clean_text": value,
                    # Honest medium confidence: recovered via a secondary
                    # pass, validated against pattern, but dot-matrix source
                    # material is still inherently uncertain.
                    "confidence": 0.6,
                    "low_confidence": True,
                    "word_count": len(value.split()),
                    "roi_recovered_for": field_name,
                }))
            else:
                print(f"  [ROI OCR] Could not recover a valid {field_name} near '{text}'.")

        return fields, splice_list

    def clean_text(self, text: str) -> str:
        """Basic text cleanup prior to LLM processing."""
        if not text:
            return ""
        text = re.sub(r'[\r\n\t]+', ' ', text)
        text = "".join(ch for ch in text if ch.isprintable())
        return re.sub(r'\s+', ' ', text).strip()

    def is_valid_detection(self, bbox: List[List[int]], text: str, confidence: float) -> bool:
        """Filters low confidence noise and tiny artifact boxes."""
        if confidence < self.min_confidence:
            return False

        xs = [pt[0] for pt in bbox]
        ys = [pt[1] for pt in bbox]
        width, height = max(xs) - min(xs), max(ys) - min(ys)

        if width < self.min_width_px or height < self.min_height_px:
            return False

        if len(text.strip()) == 1 and confidence < 0.60:
            return False

        return True

    def merge_adjacent_boxes_in_line(self, line_items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Merges adjacent horizontal bounding boxes on the same line."""
        if not line_items:
            return []

        line_items.sort(key=lambda box: box["_xmin"])
        merged: List[Dict[str, Any]] = []
        curr = line_items[0]

        for next_item in line_items[1:]:
            gap = next_item["_xmin"] - curr["_xmax"]
            avg_height = (curr["_height"] + next_item["_height"]) / 2.0
            max_allowed_gap = max(avg_height * 1.25, 25)

            if 0 <= gap <= max_allowed_gap:
                new_xmin = min(curr["_xmin"], next_item["_xmin"])
                new_xmax = max(curr["_xmax"], next_item["_xmax"])
                new_ymin = min(curr["_ymin"], next_item["_ymin"])
                new_ymax = max(curr["_ymax"], next_item["_ymax"])

                raw_combined = f"{curr['raw_text']} {next_item['raw_text']}".strip()
                clean_combined = self.clean_text(raw_combined)
                merged_confidence = round((curr["confidence"] + next_item["confidence"]) / 2.0, 4)

                merged_bbox = [
                    [int(new_xmin), int(new_ymin)],
                    [int(new_xmax), int(new_ymin)],
                    [int(new_xmax), int(new_ymax)],
                    [int(new_xmin), int(new_ymax)]
                ]

                curr = {
                    "bbox": merged_bbox,
                    "raw_text": raw_combined,
                    "clean_text": clean_combined,
                    "confidence": merged_confidence,
                    "low_confidence": merged_confidence < self.low_confidence_threshold,
                    "word_count": len(clean_combined.split()),
                    "_xmin": new_xmin,
                    "_xmax": new_xmax,
                    "_ymin": new_ymin,
                    "_ymax": new_ymax,
                    "_y_center": (new_ymin + new_ymax) / 2.0,
                    "_height": max(1, new_ymax - new_ymin)
                }
            else:
                merged.append(curr)
                curr = next_item

        merged.append(curr)
        return merged

    def sort_and_group_detections(self, detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Sorts boxes top-to-bottom and left-to-right into horizontal line buckets."""
        if not detections:
            return []

        augmented = []
        for item in detections:
            bbox = item["bbox"]
            xs, ys = [pt[0] for pt in bbox], [pt[1] for pt in bbox]
            xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)

            augmented.append({
                **item,
                "_xmin": xmin,
                "_xmax": xmax,
                "_ymin": ymin,
                "_ymax": ymax,
                "_y_center": (ymin + ymax) / 2.0,
                "_height": max(1, ymax - ymin)
            })

        augmented.sort(key=lambda box: box["_ymin"])

        lines: List[List[Dict[str, Any]]] = []
        for item in augmented:
            placed = False
            for line in lines:
                line_y_center = sum(box["_y_center"] for box in line) / len(line)
                avg_height = sum(box["_height"] for box in line) / len(line)

                if abs(item["_y_center"] - line_y_center) < (avg_height * self.line_threshold_factor):
                    line.append(item)
                    placed = True
                    break

            if not placed:
                lines.append([item])

        processed_detections = []
        for line in lines:
            merged_line = self.merge_adjacent_boxes_in_line(line)
            for item in merged_line:
                clean_item = {k: v for k, v in item.items() if not k.startswith("_")}
                processed_detections.append(clean_item)

        return processed_detections

    def draw_ocr_boxes(self, image: np.ndarray, detections: List[Dict[str, Any]]) -> np.ndarray:
        """Annotates source image with green/red bounding boxes and confidence flags."""
        annotated = image.copy()
        for idx, item in enumerate(detections, start=1):
            bbox = np.array(item["bbox"], dtype=np.int32)
            box_color = (0, 0, 255) if item.get("low_confidence", False) else (0, 255, 0)
            
            cv2.polylines(annotated, [bbox], isClosed=True, color=box_color, thickness=2)
            pt = tuple(bbox[0])
            label = f"#{idx} ({item['confidence']:.2f})"
            cv2.putText(
                annotated, label, (pt[0], max(15, pt[1] - 5)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.4, box_color, 1, cv2.LINE_AA
            )
        return annotated

    def calculate_metrics(self, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculates OCR quality stats."""
        if not items:
            return {
                "total_text_lines": 0,
                "low_confidence_lines": 0,
                "average_confidence": 0.0,
                "minimum_confidence": 0.0,
                "maximum_confidence": 0.0,
            }
        
        confidences = [item["confidence"] for item in items]
        return {
            "total_text_lines": len(items),
            "low_confidence_lines": sum(1 for item in items if item.get("low_confidence", False)),
            "average_confidence": round(float(np.mean(confidences)), 4),
            "minimum_confidence": round(float(np.min(confidences)), 4),
            "maximum_confidence": round(float(np.max(confidences)), 4),
        }

    def process_image(
        self, 
        image_input: Union[str, Path, np.ndarray], 
        filename: str = "in_memory_image.jpg"
    ) -> Tuple[Dict[str, Any], np.ndarray]:
        """Runs full pipeline: OCR -> Line Grouping -> LLM Vision Correction -> Structured JSON."""
        start_time = time.perf_counter()

        if isinstance(image_input, (str, Path)):
            img_path = Path(image_input)
            filename = img_path.name
            image = cv2.imread(str(img_path))
            if image is None:
                raise ValueError(f"Could not read image file at: {img_path}")
        else:
            image = image_input

        height, width = image.shape[:2]

        if hasattr(self.ocr, "predict"):
            ocr_res = self.ocr.predict(image)
        else:
            ocr_res = self.ocr.ocr(image)

        raw_detections = []
        if ocr_res:
            for page in ocr_res:
                # Format A: Legacy list of [[[box], (text, score)], ...]
                if isinstance(page, list):
                    for line in page:
                        if not line or len(line) < 2:
                            continue
                        bbox_coords, text_info = line[0], line[1]
                        raw_text = text_info[0] if isinstance(text_info, (list, tuple)) else str(text_info)
                        confidence = float(text_info[1]) if isinstance(text_info, (list, tuple)) and len(text_info) > 1 else 1.0
                        
                        bbox_formatted = [[int(pt[0]), int(pt[1])] for pt in bbox_coords]
                        clean_t = self.clean_text(raw_text)
                        conf_val = round(confidence, 4)

                        if self.is_valid_detection(bbox_formatted, clean_t, conf_val):
                            raw_detections.append({
                                "bbox": bbox_formatted,
                                "raw_text": raw_text,
                                "clean_text": clean_t,
                                "confidence": conf_val,
                                "low_confidence": conf_val < self.low_confidence_threshold,
                                "word_count": len(clean_t.split())
                            })
                # Format B: PaddleX dict {'rec_polys': [...], 'rec_texts': [...], 'rec_scores': [...]}
                elif isinstance(page, dict):
                    polys = page.get("rec_polys", page.get("dt_polys", []))
                    texts = page.get("rec_texts", page.get("rec_text", []))
                    scores = page.get("rec_scores", page.get("rec_score", []))

                    for poly, raw_t, score in zip(polys, texts, scores):
                        bbox_coords = poly.tolist() if hasattr(poly, "tolist") else list(poly)
                        confidence = float(score) if score is not None else 1.0
                        bbox_formatted = [[int(pt[0]), int(pt[1])] for pt in bbox_coords]
                        clean_t = self.clean_text(str(raw_t))
                        conf_val = round(confidence, 4)

                        if self.is_valid_detection(bbox_formatted, clean_t, conf_val):
                            raw_detections.append({
                                "bbox": bbox_formatted,
                                "raw_text": str(raw_t),
                                "clean_text": clean_t,
                                "confidence": conf_val,
                                "low_confidence": conf_val < self.low_confidence_threshold,
                                "word_count": len(clean_t.split())
                            })

        detections = self.sort_and_group_detections(raw_detections)

        # Stage 6 + 3/4/9: spatial bbox matching (not list order) + pattern
        # validation for the fields most prone to dot-matrix OCR failure;
        # falls back to a multi-variant, multi-engine ROI re-OCR pass only
        # when nothing already detected validates.
        print("  [*] Spatially matching + validating date/batch/MRP fields...")
        spatial_fields, roi_recoveries = self.spatial_extract_labeled_fields(image, detections)
        if roi_recoveries:
            for insert_after_idx, new_detection in sorted(roi_recoveries, key=lambda t: t[0], reverse=True):
                detections.insert(insert_after_idx + 1, new_detection)
            print(f"  [*] Recovered {len(roi_recoveries)} value(s) via ROI re-OCR.")

        raw_full_text = "\n".join(item["clean_text"] for item in detections if item["clean_text"])

        print("  [*] Invoking LLM Correction Layer (scoped: only low-confidence text checked against image)...")
        llm_results = self.llm_corrector.build_reliable_output(
            image=image,
            detections=detections,
            spatial_fields=spatial_fields,
        )

        metrics = self.calculate_metrics(detections)
        processing_time = round(time.perf_counter() - start_time, 4)

        metadata = {
            "filename": filename,
            "image_size": {"width": int(width), "height": int(height)},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "processing_time_sec": processing_time
        }

        output_payload = {
            "metadata": metadata,
            "metrics": metrics,
            "brand": llm_results.get("brand", ""),
            "product_name": llm_results.get("product_name", ""),
            "raw_full_text": raw_full_text,
            "corrected_full_text": llm_results.get("corrected_full_text", raw_full_text),
            "sections": llm_results.get("sections", []),
            "structured_data": llm_results.get("structured_data", {}),
            "corrections": llm_results.get("corrections", []),
            "field_sources": llm_results.get("field_sources", {}),
            "uncertain_or_flagged_text": llm_results.get("uncertain_or_flagged_text", []),
            "llm_correction_status": {
                "applied": llm_results.get("correction_applied", False),
                "error": llm_results.get("error", None)
            },
            "detections": detections
        }

        annotated_image = self.draw_ocr_boxes(image, detections)
        return output_payload, annotated_image

    def process_target(self, target_path: Union[str, Path], output_dir: Union[str, Path]) -> None:
        """Processes an image file or folder, saving structured JSON and debug visualization."""
        target, output_path = Path(target_path), Path(output_dir)
        annotated_path = output_path / "annotated"

        output_path.mkdir(parents=True, exist_ok=True)
        annotated_path.mkdir(parents=True, exist_ok=True)

        valid_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
        image_files = [target] if target.is_file() and target.suffix.lower() in valid_extensions else (
            [f for f in target.iterdir() if f.suffix.lower() in valid_extensions] if target.is_dir() else []
        )

        if not image_files:
            print(f"[!] No valid image files found at '{target}'")
            return

        print(f"[*] Starting OCR + LLM Pipeline for {len(image_files)} file(s)...\n")

        for img_file in image_files:
            try:
                payload, annotated_img = self.process_image(img_file)

                json_out_path = output_path / f"{img_file.stem}.json"
                with open(json_out_path, "w", encoding="utf-8") as f:
                    json.dump(payload, f, indent=2, ensure_ascii=False)

                img_out_path = annotated_path / img_file.name
                cv2.imwrite(str(img_out_path), annotated_img)

                print(
                    f"  [OK] {img_file.name} -> "
                    f"Time: {payload['metadata']['processing_time_sec']}s | "
                    f"LLM Applied: {payload['llm_correction_status']['applied']} | "
                    f"Avg Conf: {payload['metrics']['average_confidence']}"
                )
                print(f"       Saved JSON: {json_out_path}")
                print(f"       Saved Visual: {img_out_path}\n")

            except Exception as e:
                print(f"  [FAIL] Failed to process {img_file.name}: {e}")

    def process_directory(self, input_dir: Union[str, Path], output_dir: Union[str, Path]) -> None:
        """Alias for process_target for backward compatibility."""
        self.process_target(input_dir, output_dir)


if __name__ == "__main__":
    BASE_DIR = Path(__file__).parent if "__file__" in locals() else Path(".")
    PROCESSED_DIR = BASE_DIR / "dataset" / "processed"
    OUTPUT_DIR = BASE_DIR / "ocr_output"

    target_input = Path(sys.argv[1]) if len(sys.argv) > 1 else PROCESSED_DIR

    processor = LabelOCRProcessor(
        use_angle_cls=True, 
        lang="en",
        min_confidence=0.30,
        low_confidence_threshold=0.60,
        llm_model="qwen/qwen3.6-27b"
    )
    processor.process_target(target_path=target_input, output_dir=OUTPUT_DIR)