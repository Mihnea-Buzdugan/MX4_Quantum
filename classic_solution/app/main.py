from fastapi import FastAPI
from app.routers import classic_algorithm

app = FastAPI(
    title="classic API",
    description="A classic microservice",
    version="1.0.0"
)

app.include_router(classic_algorithm.router)


@app.get("/")
def home():
    return {"message": "Classic API is running!"}
