from contextlib import asynccontextmanager
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import router
from .services import shutdown_executor


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    shutdown_executor()


app = FastAPI(title="Railway Planner API", version="1.0.0", lifespan=lifespan)
allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)
app.include_router(router)

# Run from the folder that contains `app/`:
#   uvicorn app.main:app --reload