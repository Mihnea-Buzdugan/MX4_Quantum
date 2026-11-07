from pydantic import BaseModel


class QuanticInput(BaseModel):
    number1: float
    number2: float


class QuanticOutput(BaseModel):
    addition: float
    subtraction: float
    multiplication: float
    division: float | None
