# FRC 2026 REBUILT Scouting App

Offline-first scouting and strategy platform for Team NF.

## Stack

- Backend: FastAPI + PostgreSQL (JSONB) + SQLAlchemy
- Frontend: React PWA + IndexedDB fallback + QR export
- Testing: pytest, Cypress, SQL merge stress script

## Quick start

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Tests

```bash
cd backend && pytest
cd frontend && npx cypress run
```
