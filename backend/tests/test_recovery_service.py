import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import Base, Dataset, Forecast, ModelRun
from app.services.recovery_service import build_recovery_plan


class RecoveryServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)

    def tearDown(self):
        self.session.close()
        self.engine.dispose()
        self.temp_dir.cleanup()

    def _dataset(self, filename: str, rows: list[str], columns: int) -> Dataset:
        path = self.root / filename
        path.write_text("\n".join(rows), encoding="utf-8")
        dataset = Dataset(
            user_id=1,
            filename=filename,
            original_filename=filename,
            storage_path=str(path),
            file_type="csv",
            file_size=path.stat().st_size,
            row_count=len(rows) - 1,
            column_count=columns,
            status="uploaded",
        )
        self.session.add(dataset)
        self.session.commit()
        return dataset

    def test_computes_excess_and_recovery_value_from_stock_forecast_and_price(self):
        rows = ["date,product_id,product_name,category,units_sold,stock_on_hand,price,unit_cost,warehouse_id,supplier_id"]
        for day in range(20):
            daily_sales = 20 if day < 14 else 5
            for warehouse, stock in (("WH-NORTH", 70), ("WH-SOUTH", 30)):
                rows.append(
                    f"{(date(2025, 1, 1) + timedelta(days=day)).isoformat()},P-1,Widget,Tools,"
                    f"{daily_sales // 2},{stock},10,4,{warehouse},SUP-1"
                )
        dataset = self._dataset("stock.csv", rows, 10)
        run = ModelRun(dataset_id=dataset.id, model_name="Linear Regression", model_type="regression", status="completed")
        self.session.add(run)
        self.session.flush()
        for offset in range(7):
            self.session.add(Forecast(
                model_run_id=run.id,
                product_id="P-1",
                forecast_date=date(2025, 2, 1) + timedelta(days=offset),
                predicted_demand=5,
                lower_bound=4,
                upper_bound=6,
                confidence_level=0.9,
            ))
        self.session.commit()

        result = build_recovery_plan(self.session, dataset)
        product = result["products"][0]

        self.assertEqual(product["current_stock"], 100)
        self.assertEqual(product["forecast_demand"], 35)
        self.assertEqual(product["excess_quantity"], 65)
        self.assertEqual(product["estimated_recovery_value"], 650)
        self.assertEqual(product["potential_inventory_loss"], 260)
        self.assertTrue(product["declining_demand"])
        self.assertTrue(product["slow_moving"])
        self.assertEqual(result["summary"]["excess_inventory_opportunities"], 1)
        self.assertTrue(any("transfer" in item["suggested_action"].lower() for item in product["recommendations"]))
        self.assertTrue(any("supplier" in item["suggested_action"].lower() for item in product["recommendations"]))

    def test_stockout_flag_is_not_treated_as_inventory_quantity(self):
        rows = ["date,product_id,demand,stockout_flag,stock_on_hand"]
        rows.extend(f"{(date(2025, 1, 1) + timedelta(days=day)).isoformat()},P-2,{day + 1},{day % 2}," for day in range(10))
        dataset = self._dataset("without_stock.csv", rows, 5)

        result = build_recovery_plan(self.session, dataset)
        product = result["products"][0]

        self.assertFalse(result["summary"]["inventory_data_available"])
        self.assertIsNone(product["current_stock"])
        self.assertIsNone(product["excess_quantity"])
        self.assertTrue(any("stock quantities" in item for item in result["data_limitations"]))


if __name__ == "__main__":
    unittest.main()