# Quantum Railways

Quantum Railways is a responsive railway construction-planning frontend for a FastAPI railway planner. All algorithm workspaces configure the same Romania network and submit a budget, selected nodes, and candidate routes to the backend.

## Development

```sh
npm install
npm run dev
```

## Checks

```sh
npm run build
npm run lint
```

The eight cities, twelve proposed connections, destination goals, route values, and model evaluation data are defined in `src/data/routes.ts`. Construction cost refers only to building railway infrastructure. The real-hardware workspace does not connect to quantum hardware; the current FastAPI endpoint runs QAOA in its Python worker.

The frontend posts to `http://localhost:8001/railway/plan` by default. Override the full URL with `VITE_RAILWAY_PLANNER_URL` in the frontend environment. The API response contains the completed network, edge stages, QAOA diagnostics, and planner notes; the endpoint does not stream intermediate steps. The loading overlay displays facts while the request is pending.

Run the backend from the `quantic_solution` folder after installing its `requirements.txt`. The FastAPI app allows Vite origins `http://localhost:5173` and `http://127.0.0.1:5173`; customize the comma-separated allowlist with `FRONTEND_ORIGINS`.

All algorithm workspaces share a speed selector. Realtime and x0.5 currently change the loading-fact rotation only; the server-side algorithm is not throttled. Time Taken is the end-to-end API request duration, and no separate simulated execution time is reported by the backend.

Completed runs are recorded in the session-wide Run History page. History is held in memory for the current app session and can be cleared from that page.

Each algorithm workspace lets you set the construction budget, choose network nodes on the map, toggle available route edges, and edit route costs before starting a simulation. The intermediate-data panel displays returned QAOA diagnostics, conflict notes, and network completion stages after the planner responds.

### Backend setup (PowerShell)

```powershell
cd ..\quantic_solution
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```
