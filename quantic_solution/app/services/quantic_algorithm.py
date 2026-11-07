def calculate(number1: float, number2: float):
    return {
        "addition": number1 + number2,
        "subtraction": number1 - number2,
        "multiplication": number1 * number2,
        "division": (
            number1 / number2 if number2 != 0 else None
        )
    }
