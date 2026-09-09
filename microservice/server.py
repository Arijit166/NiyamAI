from contextlib import asynccontextmanager
from pathlib import Path
import tempfile
import base64

from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from pipeline import LabelExtractionPipeline
from ocr import LabelOCRProcessor, validate_field_value
from postprocess import postprocess_field


def sanitize_for_json(obj):
    """
    Recursively converts any numpy arrays, numpy scalars, or non-standard types
    into JSON-serializable Python native types.
    """
    if isinstance(obj, np.ndarray):
        return [sanitize_for_json(item) for item in obj.tolist()]
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        return float(obj)
    elif isinstance(obj, (np.bool_,)):
        return bool(obj)
    elif isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return [sanitize_for_json(v) for v in obj]
    elif isinstance(obj, Path):
        return str(obj)
    elif isinstance(obj, (int, float, str, bool)) or obj is None:
        return obj
    else:
        try:
            return obj.tolist()
        except Exception:
            return str(obj)


# Global holder for the pipeline instance
pipeline_state = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[*] Loading pipeline...")
    pipeline_state["pipeline"] = LabelExtractionPipeline(llm_model="qwen/qwen3.6-27b")
    print("[*] Pipeline ready.")
    yield
    pipeline_state.clear()


app = FastAPI(lifespan=lifespan)

# The Next.js app calls this service either server-side (proxy route) or,
# during local dev, sometimes directly from the browser — allow both.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to your deployed frontend origin in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "pipeline_loaded": "pipeline" in pipeline_state}


@app.post("/extract")
async def extract_label(
    file: UploadFile = File(...),
    marker_size_mm: Optional[float] = Form(None),
):
    """Full pipeline run on a single captured/uploaded package photo."""
    pipeline = pipeline_state.get("pipeline")
    if pipeline is None:
        return JSONResponse(status_code=503, content={"error": "Microservice pipeline is still loading. Please wait a moment."})

    suffix = Path(file.filename or "capture.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        font_size = float(marker_size_mm) if marker_size_mm and marker_size_mm > 0 else 20.0
        result, annotated_img = pipeline.process_file(
            tmp_path,
            font_config={"marker_size_mm": font_size},
        )
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": f"Pipeline processing failed: {str(e)}"})
    finally:
        tmp_path.unlink(missing_ok=True)

    if result.get("error"):
        return JSONResponse(status_code=422, content=sanitize_for_json({"error": result["error"], "quality": result.get("quality")}))

    response = {"result": result}
    if annotated_img is not None:
        try:
            _, buffer = cv2.imencode(".jpg", annotated_img)
            response["annotated_image"] = base64.b64encode(buffer).decode("utf-8")
        except Exception:
            pass

    return JSONResponse(content=sanitize_for_json(response))


@app.post("/extract-field")
async def extract_single_field(
    field_name: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Re-extracts ONE field from a fresh recapture image. Used when the
    officer is asked to "capture that part again" for a declaration the
    first pass couldn't find. Runs OCR on just this image, then lets the
    vision-assisted LLM read the field directly off the crop — same
    anti-hallucination contract as the main pipeline: returns null rather
    than guessing if the value still isn't legible.
    """
    pipeline: LabelExtractionPipeline = pipeline_state["pipeline"]
    ocr_processor: LabelOCRProcessor = pipeline.ocr_processor

    suffix = Path(file.filename).suffix or ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        image = cv2.imread(str(tmp_path))
        if image is None:
            return JSONResponse(status_code=400, content={"error": "Could not read recaptured image."})

        # Cheap OCR pass on the whole recapture crop to give the LLM a text hint.
        if hasattr(ocr_processor.ocr, "predict"):
            ocr_text = ocr_processor._ocr_roi(image)
        else:
            ocr_text = ocr_processor._ocr_roi(image)

        llm_value = ocr_processor.llm_corrector.extract_field_from_crop(
            image=image, field_class=field_name, ocr_text=ocr_text
        )

        # Run the same deterministic validators the main pipeline trusts,
        # preferring the field-specific extractor when one exists.
        candidate = llm_value or ocr_text
        post_result = postprocess_field(field_name, candidate) if candidate else None
        validated = post_result.value if (post_result and post_result.valid) else validate_field_value(field_name, candidate)

        if not validated:
            return JSONResponse(content={
                "field_name": field_name,
                "value": None,
                "confidence": 0.0,
                "reason": "Still not legible in the recaptured image.",
            })

        return JSONResponse(content={
            "field_name": field_name,
            "value": validated,
            "confidence": 0.75,
            "source": "recapture_llm_crop",
        })
    finally:
        tmp_path.unlink(missing_ok=True)
