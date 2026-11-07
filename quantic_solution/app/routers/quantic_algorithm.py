from fastapi import APIRouter
from app.schemas.quantic_algorithm import (
    QuanticInput,
    QuanticOutput
)
from app.services.quantic_algorithm import calculate

router = APIRouter(
    prefix="/quantic",
    tags=["Quantic"]
)


@router.post("/", response_model=QuanticOutput)
def calculate_numbers(data: QuanticInput):
    result = calculate(data.number1, data.number2)

    return result
