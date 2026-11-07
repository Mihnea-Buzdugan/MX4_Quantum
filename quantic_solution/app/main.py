from fastapi import FastAPI
from app.routers import quantic_algorithm

app = FastAPI(
    title="Quantum API",
    description="A quantum microservice",
    version="1.0.0"
)

app.include_router(quantic_algorithm.router)


@app.get("/")
def home():
    return {"message": "Quantum API is running!"}
