# InventIQ Backend

FastAPI application for the InventIQ inventory intelligence platform.

The backend includes authentication, dataset upload and management, model training, forecasts, alerts, recommendations, product dependencies, obsolescence analysis, simulations, and recovery planning APIs.

## Tech stack

- Python 3.14
- FastAPI
- Uvicorn (ASGI server)
- Pydantic (request/response schemas)

## Running

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Local development uses a persistent SQLite database at `backend/inventiq.db`; the schema is created automatically at startup. To use MySQL, set `DATABASE_URL` to a valid SQLAlchemy MySQL URL before starting the server. Set a strong `JWT_SECRET_KEY` outside local development.

## Single-origin full stack

Build the frontend once, then start FastAPI. The frontend is served from `/`, while API routes and Swagger remain on the same origin:

```bash
cd frontend
npm install
npm run build
cd ../backend
.venv\\Scripts\\activate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000/` for InventIQ and `http://localhost:8000/docs` for the API docs. During frontend development, Vite proxies `/api` and `/docs` to the backend.

Interactive docs are available at `http://localhost:8000/docs`.

## Project structure

```
backend/
  app/
    routers/     # API route handlers
    schemas/     # Pydantic models
    main.py      # FastAPI app factory / entry point
  requirements.txt
```

## Endpoints

| Method | Path          | Description              |
| ------ | ------------- | ------------------------ |
| GET    | `/`           | Service info             |
| GET    | `/api/health` | Health check             |
| GET    | `/docs`       | Interactive API docs     |
| GET    | `/redoc`      | API documentation        |