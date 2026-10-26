# Research paper preparation workspace

This directory contains evidence, scripts, and outputs used to assess the state of the InventIQ project for a defensible research-paper write-up.

Contents:
- `INVENTIQ_RESEARCH_PAPER_PREPARATION.md`: consolidated findings and evidence review.
- `experiments/run_model_benchmark.py`: isolated benchmark script that evaluates the implemented forecasting models on a single valid product series using a chronological split.
- `results/model_benchmark.json`: output from the benchmark script.
- `figures/model_holdout_comparison.png`: actual-vs-predicted plot for the best-performing benchmark model.
- `literature/`: placeholder for future literature extraction notes and search queries.

Important:
- No production code, database records, or uploaded data were modified.
- The benchmark is intentionally isolated under `research_paper_preparation/`.
- All numerical claims in the report are limited to what was verified by source inspection or executed experiments.
