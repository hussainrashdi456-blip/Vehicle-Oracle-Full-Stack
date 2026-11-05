"""
main.py
-------
FastAPI service for the Vehicle Price Oracle: price prediction, market stats
and damage detection. The Node backend sits in front of this service.

Run with:  uvicorn main:app --port 8000
"""

import io
import logging
import os
import secrets
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import Depends, FastAPI, File, Header, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError
from pydantic import AliasChoices, BaseModel, Field

from ai_models import (
    DATASET_YEAR,
    ModelNotReadyError,
    UnknownCategoryError,
    detect_damage,
    get_damage_model,
    get_price_model,
    predict_price,
)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
CSV_PATH = BASE_DIR / "outputs" / "clean_data.csv"

# Comma-separated list, e.g. ALLOWED_ORIGINS=https://oracle.example.com
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

# Optional shared secret between the Node backend and this service. Leave it
# unset in local development. If the React app calls this service directly,
# don't set it: a key shipped to the browser is not a secret.
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY")

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
Image.MAX_IMAGE_PIXELS = 25_000_000  # Pillow rejects anything over twice this

MIN_LISTINGS_PER_BRAND = 10  # keeps one-off listings out of the "priciest brands" chart


def require_internal_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    if INTERNAL_API_KEY and not (x_api_key and secrets.compare_digest(x_api_key, INTERNAL_API_KEY)):
        raise HTTPException(status_code=401, detail="Invalid or missing API key.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Load the heavy models up front so the first user request is not the slow one.
    for name, loader in (("price model", get_price_model), ("damage model", get_damage_model)):
        try:
            loader()
            logger.info("Loaded %s", name)
        except ModelNotReadyError as exc:
            logger.warning("%s not loaded: %s", name, exc)
    yield


app = FastAPI(
    title="Vehicle Price Oracle - AI Service",
    lifespan=lifespan,
    dependencies=[Depends(require_internal_key)],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)


# ---------------------------------------------------------------- schemas

class CarDetails(BaseModel):
    """Request body for /predict.

    The React form sends camelCase keys (mileage, engine, bodyType) while the
    training data uses Mileage_Cleaned and friends. Both spellings are accepted.
    """

    Brand: str = Field(min_length=1, max_length=60)
    Model: str = Field(min_length=1, max_length=80)
    Year: int = Field(ge=1980, le=DATASET_YEAR + 1)
    Mileage_Cleaned: float = Field(
        default=0, ge=0, le=1_000_000, validation_alias=AliasChoices("Mileage_Cleaned", "mileage")
    )
    Engine_Cleaned: float = Field(
        default=1000, ge=0, le=10_000, validation_alias=AliasChoices("Engine_Cleaned", "engine")
    )
    Fuel: str = Field(min_length=1, max_length=30)
    Transmission: str = Field(min_length=1, max_length=30)
    Province: str = Field(min_length=1, max_length=40)
    Body_Type: str = Field(
        default="Sedan", max_length=30, validation_alias=AliasChoices("Body_Type", "bodyType")
    )
    Feature_Count: Optional[int] = Field(default=None, ge=0, le=60)
    features: list[str] = Field(default_factory=list, max_length=60)


# ---------------------------------------------------------------- dataset

@lru_cache(maxsize=1)
def load_listings() -> pd.DataFrame:
    """Read the cleaned CSV once. Restart the server after regenerating it."""
    if not CSV_PATH.exists():
        raise FileNotFoundError(CSV_PATH)
    return pd.read_csv(CSV_PATH)


def get_listings() -> pd.DataFrame:
    try:
        return load_listings()
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="Listings dataset not found. Run run_pipeline.py first.")


def _top_counts(series: pd.Series, limit: int) -> list:
    return [{"name": str(name), "value": int(count)} for name, count in series.value_counts().head(limit).items()]


# ---------------------------------------------------------------- routes

@app.post("/predict")
def predict(car: CarDetails):
    # An explicit Feature_Count wins; otherwise count the ticked features; 5 is the old default.
    feature_count = car.Feature_Count if car.Feature_Count is not None else (len(car.features) or 5)

    details = {
        "Brand": car.Brand,
        "Model": car.Model,
        "Year": car.Year,
        "Mileage_Cleaned": car.Mileage_Cleaned,
        "Engine_Cleaned": car.Engine_Cleaned,
        "Fuel": car.Fuel,
        "Transmission": car.Transmission,
        "Province": car.Province,
        "Body Type": car.Body_Type,
        "Feature_Count": feature_count,
    }

    try:
        return predict_price(details)
    except ModelNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except UnknownCategoryError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception:
        logger.exception("Price prediction failed")
        raise HTTPException(status_code=500, detail="Price prediction failed.")


@app.get("/api/stats")
def get_stats():
    listings = get_listings()
    mean_price = listings["Price_Cleaned"].mean()
    return {
        "total_cars": int(len(listings)),
        "avg_price": int(mean_price) if pd.notna(mean_price) else 0,
        "brands": int(listings["Brand"].nunique()),
        "models": int(listings["Model"].nunique()),
    }


@lru_cache(maxsize=1)
def _build_car_options() -> dict:
    listings = load_listings()
    brand_models = {
        brand: sorted(group["Model"].dropna().unique().tolist())
        for brand, group in listings.groupby("Brand")
    }
    return {
        "brand_models": brand_models,
        "provinces": sorted(listings["Province"].dropna().unique().tolist()),
        "body_types": sorted(listings["Body Type"].dropna().unique().tolist()),
        "fuels": sorted(listings["Fuel"].dropna().unique().tolist()),
        "transmissions": sorted(listings["Transmission"].dropna().unique().tolist()),
    }


@app.get("/api/car-options")
def get_car_options():
    get_listings()  # turns a missing CSV into a clean 503
    return _build_car_options()


@app.get("/api/car-details")
def get_car_details(
    brand: str = Query(min_length=1, max_length=60),
    model: str = Query(min_length=1, max_length=80),
):
    listings = get_listings()
    matches = listings[(listings["Brand"] == brand) & (listings["Model"] == model)]
    if matches.empty:
        return {}  # the form treats "no match" as "nothing to autofill"

    median_engine = matches["Engine_Cleaned"].median()
    common_body_types = matches["Body Type"].mode()
    return {
        "engine": int(round(median_engine / 50) * 50) if pd.notna(median_engine) else 1300,
        "bodyType": str(common_body_types.iloc[0]) if not common_body_types.empty else "Sedan",
        "available_body_types": sorted(matches["Body Type"].dropna().unique().tolist()),
        "available_fuels": sorted(matches["Fuel"].dropna().unique().tolist()),
        "available_transmissions": sorted(matches["Transmission"].dropna().unique().tolist()),
    }


@app.post("/api/detect-damage")
async def detect_damage_route(file: UploadFile = File(...)):
    # content_type is whatever the client claims; Pillow decoding below is the real check.
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG or WebP images are accepted.")

    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image must be smaller than 5 MB.")

    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
        image = image.convert("RGB")
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError):
        raise HTTPException(status_code=400, detail="That file could not be read as an image.")

    try:
        # YOLO inference is CPU-bound; keep it off the event loop.
        return await run_in_threadpool(detect_damage, image)
    except ModelNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception:
        logger.exception("Damage detection failed")
        raise HTTPException(status_code=500, detail="Damage detection failed.")


@lru_cache(maxsize=1)
def _build_trends() -> dict:
    listings = load_listings()
    priced = listings.dropna(subset=["Price_Cleaned"])

    avg_by_year = priced.groupby("Year")["Price_Cleaned"].mean()
    avg_by_year = avg_by_year[avg_by_year.index >= 2010]

    brand_sizes = priced["Brand"].value_counts()
    established = priced[priced["Brand"].isin(brand_sizes[brand_sizes >= MIN_LISTINGS_PER_BRAND].index)]
    if established.empty:  # tiny dataset: don't return an empty chart
        established = priced
    priciest_brands = established.groupby("Brand")["Price_Cleaned"].mean().nlargest(5)

    return {
        "year_trend": [{"year": int(year), "avgPrice": int(price)} for year, price in avg_by_year.items()],
        "brand_trend": [{"brand": brand, "avgPrice": int(price)} for brand, price in priciest_brands.items()],
        "body_types": _top_counts(listings["Body Type"], 6),
        "provinces": _top_counts(listings["Province"], 5),
    }


@app.get("/api/trends")
def get_trends():
    get_listings()
    return _build_trends()


@app.get("/api/market-comparison")
def get_market_comparison(
    brand: str = Query(min_length=1, max_length=60),
    model: str = Query(min_length=1, max_length=80),
    year: int = Query(ge=1980, le=DATASET_YEAR + 1),
):
    priced = get_listings().dropna(subset=["Price_Cleaned"])
    near_year = priced["Year"].between(year - 2, year + 2)

    comparable = priced[(priced["Brand"] == brand) & (priced["Model"] == model) & near_year]
    match_level = "model"
    if comparable.empty:
        # No exact model within +/- 2 years, so widen to the whole brand.
        comparable = priced[(priced["Brand"] == brand) & near_year]
        match_level = "brand"

    if comparable.empty:
        return {"average_price": None, "listings_found": 0, "match_level": None}

    return {
        "average_price": int(comparable["Price_Cleaned"].mean()),
        "min_price": int(comparable["Price_Cleaned"].min()),
        "max_price": int(comparable["Price_Cleaned"].max()),
        "listings_found": int(len(comparable)),
        "match_level": match_level,
    }
