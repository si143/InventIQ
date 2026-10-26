import unittest
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers.dependencies import _with_product_names
from app.routers.datasets import _build_dashboard_analytics, _build_demand_history
from app.services.dependency_service import _pairs, product_identity_map


class ProductIdentityMapTests(unittest.TestCase):
    def test_dashboard_analytics_aggregates_full_dataset_fields(self):
        dataset = pd.DataFrame({
            "sales_date": ["2025-01-01", "2025-01-01", "2025-01-02"],
            "product_id": ["P-1", "P-1", "P-2"],
            "product_name": ["Widget", "Widget", "Gadget"],
            "category": ["Tools", "Tools", "Home"],
            "units_sold": [2, 3, 7],
            "price": [10, 10, 5],
        })

        result = _build_dashboard_analytics(dataset)

        self.assertEqual(result["total_units_sold"], 12)
        self.assertEqual(result["total_sales"], 85)
        self.assertEqual(result["product_count"], 2)
        self.assertEqual(result["average_daily_sales"], 6)
        self.assertEqual(result["trend"], [
            {"date": "2025-01-01", "units_sold": 5.0},
            {"date": "2025-01-02", "units_sold": 7.0},
        ])
        self.assertEqual(result["top_products"][0]["product_name"], "Gadget")
        self.assertEqual(result["categories"][0], {"category": "Home", "units_sold": 7.0})

    def test_dashboard_analytics_marks_unavailable_values_without_source_columns(self):
        result = _build_dashboard_analytics(pd.DataFrame({"description": ["item A", "item B"]}))

        self.assertIsNone(result["total_units_sold"])
        self.assertIsNone(result["total_sales"])
        self.assertIsNone(result["product_count"])
        self.assertIsNone(result["average_daily_sales"])
        self.assertEqual(result["trend"], [])

    def test_demand_history_aggregates_real_rows_by_configured_date_and_product(self):
        dataset = pd.DataFrame({
            "sold_on": ["2025-01-01", "2025-01-01", "2025-01-02"],
            "sku": ["P-1", "P-1", "P-2"],
            "units": [2, 3, 7],
        })

        result = _build_demand_history(dataset, {
            "date_column": "sold_on",
            "product_column": "sku",
            "target_column": "units",
        })

        self.assertEqual(result["rows"], [
            {"date": "2025-01-01", "product_id": "P-1", "actual_demand": 5.0},
            {"date": "2025-01-02", "product_id": "P-2", "actual_demand": 7.0},
        ])

    def test_maps_product_ids_to_names_from_dataset(self):
        dataset = pd.DataFrame({
            "product_id": ["P003", "P020"],
            "product_name": ["Notebook from file", "Carry Case from file"],
        })

        identities = product_identity_map(dataset, "product_id")
        response = _with_product_names(
            {"product_a": "P003", "product_b": "P020"},
            identities,
        )

        self.assertEqual(response["product_a_id"], "P003")
        self.assertEqual(response["product_a_name"], "Notebook from file")
        self.assertEqual(response["product_b_id"], "P020")
        self.assertEqual(response["product_b_name"], "Carry Case from file")

    def test_identity_mapping_is_dataset_scoped(self):
        first_dataset = pd.DataFrame({"product_id": ["P003"], "product_name": ["First dataset item"]})
        second_dataset = pd.DataFrame({"product_id": ["P003"], "product_name": ["Second dataset item"]})

        first_identity = product_identity_map(first_dataset, "product_id")["P003"]
        second_identity = product_identity_map(second_dataset, "product_id")["P003"]

        self.assertEqual(first_identity["product_name"], "First dataset item")
        self.assertEqual(second_identity["product_name"], "Second dataset item")

    def test_mapping_resolves_existing_name_keys(self):
        dataset = pd.DataFrame({"product_id": ["P003"], "product_name": ["Notebook from file"]})

        identities = product_identity_map(dataset, "product_name")

        self.assertEqual(identities["Notebook from file"]["product_id"], "P003")
        self.assertEqual(identities["Notebook from file"]["product_name"], "Notebook from file")
        self.assertEqual(identities["P003"]["product_name"], "Notebook from file")

    def test_missing_product_name_uses_fallback(self):
        dataset = pd.DataFrame({"product_id": ["P003"]})

        identity = product_identity_map(dataset, "product_id")["P003"]

        self.assertEqual(identity["product_id"], "P003")
        self.assertEqual(identity["product_name"], "Name unavailable")

    def test_missing_product_id_uses_fallback(self):
        dataset = pd.DataFrame({"product_name": ["Uncatalogued item"]})

        identity = product_identity_map(dataset, "product_name")["Uncatalogued item"]

        self.assertEqual(identity["product_id"], "Unknown Product")
        self.assertEqual(identity["product_name"], "Uncatalogued item")

    def test_missing_identity_uses_both_response_fallbacks(self):
        response = _with_product_names(
            {"product_a": "P001", "product_b": "P002"},
            {},
        )

        self.assertEqual(response["product_a_id"], "Unknown Product")
        self.assertEqual(response["product_a_name"], "Name unavailable")
        self.assertEqual(response["product_b_id"], "Unknown Product")
        self.assertEqual(response["product_b_name"], "Name unavailable")

    def test_dependency_calculation_values_are_unchanged(self):
        matrix = pd.DataFrame({
            "P003": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            "P020": [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
        })

        pair = _pairs(matrix)[0]

        self.assertEqual(pair.correlation, 1.0)
        self.assertEqual(pair.relationship_type, "Positive")
        self.assertEqual(pair.relationship_strength, "Very Strong")
        self.assertEqual(pair.dependency_score, 66.67)


if __name__ == "__main__":
    unittest.main()