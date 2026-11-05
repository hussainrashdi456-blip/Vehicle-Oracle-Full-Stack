"""
ai_models.py
------------
Model layer for the Vehicle Price Oracle.

* Price prediction: XGBoost regressor, plus the label encoders and feature
  order that the training pipeline (run_pipeline.py) saved next to it.
* Damage detection: YOLOv8 weights trained on car-damage images.

Nothing in here knows about HTTP. main.py calls these functions and maps the
exceptions below to proper status codes.
"""

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
import xgboost as xgb
from PIL import Image

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "outputs"

MODEL_PATH = OUTPUT_DIR / "xgb_car_price_model.pkl"
ENCODERS_PATH = OUTPUT_DIR / "label_encoders.pkl"
FEATURES_PATH = OUTPUT_DIR / "feature_columns.pkl"

# Weights for the damage detector. Set YOLO_WEIGHTS if they live somewhere else.
DAMAGE_WEIGHTS_PATH = Path(os.getenv("YOLO_WEIGHTS", OUTPUT_DIR / "damage_best.pt"))

# Car_Age = DATASET_YEAR - model year. The listings were scraped in 2025, so
# this has to match whatever the training pipeline used. If you retrain with
# "current year" logic, change it here too, otherwise ages will be off by one.
DATASET_YEAR = 2025


class ModelNotReadyError(RuntimeError):
    """A model file is missing or its library is not installed."""


class UnknownCategoryError(ValueError):
    """The request contains a brand, model, fuel, etc. the model never saw."""


@dataclass(frozen=True)
class PriceModel:
    regressor: Any
    encoders: dict
    feature_names: list


@lru_cache(maxsize=1)
def get_price_model() -> PriceModel:
    """Load the XGBoost model once and reuse it. Failures are not cached, so the
    next call retries after you have run the training pipeline."""
    required = (MODEL_PATH, ENCODERS_PATH, FEATURES_PATH)
    missing = [path.name for path in required if not path.exists()]
    if missing:
        raise ModelNotReadyError(
            f"Missing model files: {', '.join(missing)}. Run run_pipeline.py first."
        )
    return PriceModel(
        regressor=joblib.load(MODEL_PATH),
        encoders=joblib.load(ENCODERS_PATH),
        feature_names=list(joblib.load(FEATURES_PATH)),
    )


def _build_feature_frame(model: PriceModel, car: dict) -> pd.DataFrame:
    """Turn the request into the one-row frame the model was trained on."""
    row = {
        "Brand": car["Brand"],
        "Model": car["Model"],
        "Car_Age": max(DATASET_YEAR - int(car["Year"]), 0),
        "Mileage_Cleaned": float(car["Mileage_Cleaned"]),
        "Engine_Cleaned": float(car["Engine_Cleaned"]),
        "Fuel": car["Fuel"],
        "Transmission": car["Transmission"],
        "Province": car["Province"],
        "Body Type": car["Body Type"],
        "Feature_Count": int(car["Feature_Count"]),
    }

    for column, encoder in model.encoders.items():
        if column not in row:
            continue
        value = str(row[column])
        # Encoding an unseen value as 0 would quietly price the car as whichever
        # label sorts first alphabetically, so we refuse instead.
        if value not in encoder.classes_:
            raise UnknownCategoryError(f"'{value}' is not a known value for {column}.")
        row[column] = int(encoder.transform([value])[0])

    return pd.DataFrame([row])[model.feature_names]


def _top_factors(model: PriceModel, features: pd.DataFrame, limit: int = 5) -> list:
    """Per-prediction SHAP contributions, computed by XGBoost itself.

    Values are in the same units as the price: positive pushes the estimate up,
    negative pulls it down. The last column XGBoost returns is the bias term,
    which is not a feature, so it is dropped.
    """
    try:
        booster = model.regressor.get_booster()
        contributions = booster.predict(xgb.DMatrix(features), pred_contribs=True)[0]
    except Exception:
        logger.exception("Could not compute feature contributions")
        return []

    ranked = sorted(
        zip(model.feature_names, contributions[:-1]),
        key=lambda pair: abs(pair[1]),
        reverse=True,
    )
    return [
        {
            "feature": name,
            "importance": round(float(value), 2),
            "direction": "up" if value >= 0 else "down",
        }
        for name, value in ranked[:limit]
    ]


def predict_price(car: dict) -> dict:
    """Estimate a used-car price.

    Expected keys in `car`: Brand, Model, Year, Mileage_Cleaned, Engine_Cleaned,
    Fuel, Transmission, Province, "Body Type", Feature_Count.

    Returns {"price": float, "explanation": {"top_factors": [...], "note": str}}.
    Raises ModelNotReadyError or UnknownCategoryError; main.py turns those
    into 503 and 422 responses.
    """
    model = get_price_model()
    features = _build_feature_frame(model, car)
    price = float(model.regressor.predict(features)[0])

    return {
        "price": price,
        "explanation": {
            "top_factors": _top_factors(model, features),
            "note": "Features that moved this estimate the most. Positive means it raised the price.",
        },
    }


@lru_cache(maxsize=1)
def get_damage_model():
    """Load the YOLOv8 damage detector once. ultralytics pulls in torch, so the
    import stays inside the function and the price API still starts without it."""
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise ModelNotReadyError("ultralytics is not installed.") from exc

    if not DAMAGE_WEIGHTS_PATH.exists():
        raise ModelNotReadyError(f"Damage weights not found at {DAMAGE_WEIGHTS_PATH}.")
    return YOLO(str(DAMAGE_WEIGHTS_PATH))


def detect_damage(image: Image.Image, min_confidence: float = 0.25) -> dict:
    """Run the damage detector on a PIL image and return boxes in pixel coordinates."""
    detector = get_damage_model()
    results = detector.predict(image, conf=min_confidence, verbose=False)

    detections = []
    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            detections.append(
                {
                    "label": detector.names[int(box.cls[0])],
                    "confidence": round(float(box.conf[0]), 2),
                    "box": [int(x1), int(y1), int(x2), int(y2)],
                }
            )

    return {
        "damage_detected": bool(detections),
        "detections": detections,
        "message": f"{len(detections)} damaged region(s) found.",
    }
