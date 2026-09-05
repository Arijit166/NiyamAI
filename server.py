"""
server.py
---------
FastAPI backend that loads the pipeline once at startup and
reuses it for every incoming request.
"""

from contextlib import asynccontextmanager
from pathlib import Path
import tempfile
import base64

import cv2
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse

from pipeline import LabelExtractionPipeline

# Global holder for the pipeline instance
pipeline_state = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: load OCR + LLM once
    print("[*] Loading pipeline...")
    pipeline_state["pipeline"] = LabelExtractionPipeline(llm_model="qwen/qwen3.6-27b")
    print("[*] Pipeline ready.")
    yield
    # Shutdown: cleanup if needed
    pipeline_state.clear()


app = FastAPI(lifespan=lifespan)


@app.post("/extract")
async def extract_label(file: UploadFile = File(...)):
    pipeline = pipeline_state["pipeline"]

    # Save upload to a temp file since pipeline.process_file expects a path
    suffix = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)

    try:
        result, annotated_img = pipeline.process_file(tmp_path)
    finally:
        tmp_path.unlink(missing_ok=True)

    response = {"result": result}

    # Optionally return the annotated image as base64
    if annotated_img is not None:
        ok, buf = cv2.imencode(".jpg", annotated_img)
        if ok:
            response["annotated_image_base64"] = base64.b64encode(buf).decode("utf-8")

    return JSONResponse(content=response)