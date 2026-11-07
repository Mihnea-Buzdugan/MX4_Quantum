from contextlib import asynccontextmanager

from fastapi import FastAPI

from .routers import router
from .services import shutdown_executor


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    shutdown_executor()


app = FastAPI(title="Railway Planner API", version="1.0.0", lifespan=lifespan)
app.include_router(router)

# Run from the folder that contains `app/`:
#   uvicorn app.main:app --reload