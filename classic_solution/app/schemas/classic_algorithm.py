from pydantic import BaseModel


class ClassicInput(BaseModel):
    number1: float
    number2: float


class ClassicOutput(BaseModel):
    addition: float
    subtraction: float
    multiplication: float
    division: float | None
