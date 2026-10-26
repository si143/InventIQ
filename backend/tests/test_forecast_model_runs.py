import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import Base, Dataset, Forecast, ModelRun
from app.routers.forecasts import create_forecast
from app.routers.model_runs import list_model_runs, train_model
from app.routers.simulations import (
    CounterfactualRequest,
    SimulationRequest,
    create_counterfactual,
    create_simulation,
)
from app.schemas.requests import ForecastGenerateRequest, ModelRunTrainRequest


class ForecastModelRunTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.dataset = Dataset(
            user_id=7,
            filename="sales.csv",
            original_filename="sales.csv",
            storage_path=str(self.root / "sales.csv"),
            file_type="csv",
            file_size=0,
            status="uploaded",
        )
        self.session.add(self.dataset)
        self.session.flush()
        self.run = ModelRun(
            dataset_id=self.dataset.id,
            model_name="XGBoost",
            model_type="regression",
            status="completed",
            artifact_path="model_artifacts/run.pkl",
        )
        self.session.add(self.run)
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_completed_model_runs_are_retrievable_for_the_selected_dataset(self):
        user = SimpleNamespace(id=7)

        result = list_model_runs(user=user, db=self.session, dataset_id=self.dataset.id)

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], self.run.id)
        self.assertEqual(result[0]["dataset_id"], self.dataset.id)
        self.assertEqual(result[0]["status"], "completed")
        self.assertEqual(result[0]["model_name"], "XGBoost")
        self.assertEqual(result[0]["model_type"], "regression")

    def test_forecast_request_keeps_dataset_optional_for_existing_clients(self):
        request = ForecastGenerateRequest(model_run_id=self.run.id, forecast_horizon=7)

        self.assertIsNone(request.dataset_id)

    def test_forecast_rejects_dataset_that_does_not_match_model_run(self):
        request = ForecastGenerateRequest(
            model_run_id=self.run.id,
            dataset_id=self.dataset.id + 1,
            forecast_horizon=7,
        )

        with self.assertRaises(HTTPException) as raised:
            create_forecast(request=request, user=SimpleNamespace(id=7), db=self.session)

        self.assertEqual(raised.exception.status_code, 409)
        self.assertIn("does not match", raised.exception.detail)

    def test_training_listing_and_forecast_generation_work_end_to_end(self):
        lines = ["date,product_id,units_sold"]
        for offset in range(30):
            lines.append(f"{date(2025, 1, 1) + timedelta(days=offset)},SKU-1,{10 + offset}")
        Path(self.dataset.storage_path).write_text("\n".join(lines), encoding="utf-8")
        training_request = ModelRunTrainRequest(
            dataset_id=self.dataset.id,
            target_column="units_sold",
            date_column="date",
            product_column="product_id",
            forecast_horizon=7,
            model_name="Linear Regression",
        )
        user = SimpleNamespace(id=7)
        artifact_dir = self.root / "model_artifacts"

        with (
            patch("app.services.model_service.ARTIFACT_DIR", artifact_dir),
            patch("app.services.model_service.ARTIFACT_ROOT", self.root),
        ):
            trained = train_model(request=training_request, user=user, db=self.session)
            self.session.expire_all()

            available_runs = list_model_runs(user=user, db=self.session, dataset_id=self.dataset.id)
            matching_runs = [
                run for run in available_runs
                if run["id"] == trained["id"]
                and run["dataset_id"] == self.dataset.id
                and run["status"] == "completed"
            ]
            self.assertEqual(len(matching_runs), 1)
            self.assertTrue((self.root / trained["artifact_path"]).is_file())

            generated = create_forecast(
                request=ForecastGenerateRequest(
                    model_run_id=trained["id"],
                    dataset_id=self.dataset.id,
                    forecast_horizon=7,
                ),
                user=user,
                db=self.session,
            )

        self.assertEqual(generated["model_run_id"], trained["id"])
        self.assertEqual(generated["dataset_id"], self.dataset.id)
        self.assertEqual(len(generated["forecasts"]), 7)
        self.assertTrue(all(row["predicted_demand"] is not None for row in generated["forecasts"]))
        persisted_forecasts = self.session.query(Forecast).filter(Forecast.model_run_id == trained["id"]).count()
        self.assertEqual(persisted_forecasts, 7)

        simulated = create_simulation(
            request=SimulationRequest(
                dataset_id=self.dataset.id,
                forecast_run_id=trained["id"],
                simulation_type="demand_spike",
                demand_change=25,
            ),
            user=user,
            db=self.session,
        )
        self.assertEqual(simulated["dataset_id"], self.dataset.id)
        self.assertEqual(simulated["parameters"]["forecast_run_id"], trained["id"])
        baseline = sum(row["predicted_demand"] for row in generated["forecasts"])
        self.assertAlmostEqual(simulated["results"]["baseline_demand"], baseline, places=4)
        self.assertAlmostEqual(simulated["results"]["simulated_demand"], baseline * 1.25, places=4)

        counterfactual = create_counterfactual(
            request=CounterfactualRequest(
                dataset_id=self.dataset.id,
                forecast_run_id=trained["id"],
                adjustment_percent=10,
            ),
            user=user,
            db=self.session,
        )
        self.assertEqual(counterfactual["parameters"]["forecast_run_id"], trained["id"])
        self.assertEqual(counterfactual["results"]["forecast_run_id"], trained["id"])

    def test_simulation_requires_saved_forecasts_for_the_selected_run(self):
        with self.assertRaises(HTTPException) as raised:
            create_simulation(
                request=SimulationRequest(
                    dataset_id=self.dataset.id,
                    forecast_run_id=self.run.id,
                    simulation_type="supplier_delay",
                    lead_time_delay=5,
                ),
                user=SimpleNamespace(id=7),
                db=self.session,
            )

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("Generate a forecast", raised.exception.detail)

    def test_simulation_does_not_use_a_forecast_from_another_dataset(self):
        other_dataset = Dataset(
            user_id=7,
            filename="other.csv",
            original_filename="other.csv",
            storage_path=str(self.root / "other.csv"),
            file_type="csv",
            file_size=0,
            status="uploaded",
        )
        self.session.add(other_dataset)
        self.session.flush()
        other_run = ModelRun(
            dataset_id=other_dataset.id,
            model_name="XGBoost",
            model_type="regression",
            status="completed",
            artifact_path="model_artifacts/other.pkl",
        )
        self.session.add(other_run)
        self.session.flush()
        self.session.add(Forecast(
            model_run_id=other_run.id,
            product_id="SKU-OTHER",
            forecast_date=date(2025, 2, 1),
            predicted_demand=42,
        ))
        self.session.commit()

        with self.assertRaises(HTTPException) as raised:
            create_simulation(
                request=SimulationRequest(
                    dataset_id=self.dataset.id,
                    forecast_run_id=other_run.id,
                    simulation_type="demand_spike",
                ),
                user=SimpleNamespace(id=7),
                db=self.session,
            )

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("selected completed model run and dataset", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
