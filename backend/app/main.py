"""Loopback-first REST application. Run with uvicorn backend.app.main:app."""

import csv
import io
import json
import os
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .agents import chat_agent, pending_analysis, run_analysis
from .models import ChatRequest
from .store import MAX_RECORDS, Store

MAX_UPLOAD_BYTES = 2 * 1024 * 1024
LOCAL_ORIGINS = {f"http://{host}:{port}" for host in ("localhost", "127.0.0.1") for port in (5173, 4173, 8000)}
SAMPLE_CSV = """patient_id,date,measurement,value,unit,reference_range
DEMO-UPLOAD,2024-03-15,LDL,105,mg/dL,
DEMO-UPLOAD,2025-03-15,LDL,118,mg/dL,
DEMO-UPLOAD,2026-03-15,LDL,132,mg/dL,
DEMO-UPLOAD,2024-03-15,HDL,52,mg/dL,
DEMO-UPLOAD,2025-03-15,HDL,54,mg/dL,
DEMO-UPLOAD,2026-03-15,HDL,56,mg/dL,
"""


def parse_upload(content, filename):
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("Upload must use UTF-8 text encoding") from None
    extension = Path(filename or "").suffix.lower()
    source = "User-supplied synthetic demonstration upload"
    source_url = None
    if extension == ".csv":
        reader = csv.DictReader(io.StringIO(text))
        required = {"patient_id", "date", "measurement", "value", "unit"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise ValueError("CSV requires patient_id,date,measurement,value,unit column headers")
        if len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError("CSV column headers must be unique")
        records = []
        try:
            for row in reader:
                if None in row or any(row.get(field) is None for field in required):
                    raise ValueError(f"CSV row {reader.line_num} has the wrong number of columns")
                records.append(row)
                if len(records) > MAX_RECORDS:
                    raise ValueError("Upload exceeds the 10,000 observation limit")
        except csv.Error:
            raise ValueError("CSV could not be parsed; check quoting and field lengths") from None
    elif extension == ".json":
        def reject_constant(value):
            raise ValueError(f"JSON contains a non-finite value: {value}")
        try:
            payload = json.loads(text, parse_constant=reject_constant)
        except RecursionError:
            raise ValueError("JSON is nested too deeply; provide a flat array of observations") from None
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid JSON at line {error.lineno}, column {error.colno}") from None
        if isinstance(payload, dict):
            records = payload.get("records")
            source = payload.get("source", source)
            source_url = payload.get("source_url")
        else:
            records = payload
    else:
        raise ValueError("Choose a .csv or .json file containing synthetic observation records")
    return records, source, source_url


def create_app(db_path=None):
    api = FastAPI(title="HealthLens AI", version="0.1.0", description="Local synthetic-data informational prototype")
    root = Path(__file__).resolve().parents[2]
    store = Store(db_path or os.environ.get("HEALTHLENS_DB_PATH") or root / "data" / "healthlens.sqlite3")
    api.state.store = store
    api.add_middleware(CORSMiddleware, allow_origins=sorted(LOCAL_ORIGINS), allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])
    api.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver", "[::1]"])

    @api.middleware("http")
    async def local_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD", "OPTIONS") and origin and origin not in LOCAL_ORIGINS:
            return JSONResponse({"detail": "This local prototype only accepts requests from its local interface"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @api.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        detail = "; ".join(f"{'.'.join(map(str, item['loc']))}: {item['msg']}" for item in error.errors())
        return JSONResponse({"detail": detail}, status_code=422)

    def get_analysis(analysis_id):
        analysis = store.analysis(analysis_id)
        if analysis is None:
            raise HTTPException(404, "Analysis not found")
        return analysis

    @api.get("/api/health")
    def health():
        return {"status": "ok", "explanation_mode": "deterministic", "version": "0.1.0"}

    @api.get("/api/patients")
    def patients():
        return {"patients": store.patients()}

    @api.get("/api/patients/{patient_id}/records")
    def patient_records(patient_id: str):
        patient = store.patient(patient_id)
        if patient is None:
            raise HTTPException(404, "Patient not found")
        return {"patient": patient, "records": store.records(patient_id)}

    @api.post("/api/upload")
    async def upload(file: UploadFile = File(...)):
        try:
            content = await file.read(MAX_UPLOAD_BYTES + 1)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Upload exceeds the 2 MB file limit")
            records, source, source_url = parse_upload(content, file.filename)
            patients = store.ingest(records, source, source_url)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
        finally:
            await file.close()
        return {"patients": patients, "message": f"Imported {len(patients)} synthetic patient profile(s). Source records are stored locally."}

    @api.post("/api/analyze/{patient_id}")
    def analyze(patient_id: str, background_tasks: BackgroundTasks):
        if store.patient(patient_id) is None:
            raise HTTPException(404, "Patient not found")
        analysis = pending_analysis(patient_id)
        if not store.save_analysis(analysis, create=True):
            raise HTTPException(404, "Patient no longer available; local data may have been reset")
        background_tasks.add_task(run_analysis, store, analysis)
        return {"analysis_id": analysis["id"]}

    @api.get("/api/analysis/{analysis_id}")
    def analysis(analysis_id: str):
        return get_analysis(analysis_id)

    @api.get("/api/analysis/{analysis_id}/trends")
    def trends(analysis_id: str):
        return {"trends": get_analysis(analysis_id)["trends"]}

    @api.get("/api/analysis/{analysis_id}/evidence")
    def evidence(analysis_id: str):
        return {"evidence": get_analysis(analysis_id)["evidence"]}

    @api.post("/api/chat")
    def chat(request: ChatRequest):
        analysis = get_analysis(request.analysis_id)
        if analysis["status"] != "completed":
            raise HTTPException(409, "Wait for analysis to complete before asking a question")
        try:
            return chat_agent(store, analysis, request.question, request.previous_measurements)
        except ValueError:
            raise HTTPException(409, "Source records changed. Run a new analysis before continuing.") from None

    @api.delete("/api/data")
    def reset():
        store.reset()
        return {"message": "Local uploads and analyses were deleted. Synthetic demonstration profiles are retained."}

    @api.get("/api/sample.csv")
    def sample():
        return Response(SAMPLE_CSV, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="healthlens-synthetic-sample.csv"'})

    frontend_dist = root / "frontend" / "dist"
    if frontend_dist.is_dir():
        api.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
    return api


app = create_app()
