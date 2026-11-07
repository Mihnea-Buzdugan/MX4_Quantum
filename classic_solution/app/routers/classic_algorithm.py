from fastapi import APIRouter
from app.schemas.classic_algorithm import (
    ClassicInput,
    ClassicOutput
)
from app.services.classic_algorithm import calculate

router = APIRouter(
    prefix="/classic",
    tags=["Classic"]
)


@router.post("/", response_model=ClassicOutput)
def calculate_numbers(data: ClassicInput):
    result = calculate(data.number1, data.number2)

    return result
