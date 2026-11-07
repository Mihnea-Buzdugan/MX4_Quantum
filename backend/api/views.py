import json
import logging
import os
import secrets
import string

import httpx

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import update_last_login
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from google.auth.transport.requests import Request
from google.oauth2 import id_token

from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken


def generate_password(length=12):
    alphabet = string.ascii_letters + string.digits + string.punctuation
    return ''.join(secrets.choice(alphabet) for _ in range(length))


def get_tokens_for_user(user):
    """Issue a fresh access/refresh pair for the given user."""
    # django_login() used to update last_login via a signal; do it manually now.
    update_last_login(None, user)

    refresh = RefreshToken.for_user(user)
    return {
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }


class SignUpView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        data = request.data

        email = data.get("email")
        username = data.get("username")
        password = data.get("password")
        first_name = data.get("first_name")
        last_name = data.get("last_name")

        User = get_user_model()

        if User.objects.filter(email=email).exists():
            return Response(
                {"message": "Email is already in use."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(username=username).exists():
            return Response(
                {"message": "Username is already in use."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = User.objects.create_user(
                email=email,
                username=username,
                password=password,
                first_name=first_name,
                last_name=last_name,
            )
        except ValidationError as e:
            return Response(
                {"message": str(e)},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "message": "User created and logged in successfully.",
                "tokens": get_tokens_for_user(user),
                "user": {
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "username": user.username,
                },
            },
            status=status.HTTP_201_CREATED,
        )


class LoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        email = request.data.get("email")
        password = request.data.get("password")

        if not email or not password:
            return Response(
                {"message": "Email and Password are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user = authenticate(
            request,
            username=email,  # assuming your auth backend uses email as username
            password=password,
        )

        if user is None:
            return Response(
                {"message": "Invalid credentials"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "message": "User login successful",
                "tokens": get_tokens_for_user(user),
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "is_superuser": user.is_superuser,
                },
            },
            status=status.HTTP_200_OK,
        )


class GoogleLoginView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        google_client_id = os.environ.get("client_id_Google")

        google_token = request.data.get("google_token")

        if not google_token:
            return Response(
                {"message": "Invalid Google token"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            id_info = id_token.verify_oauth2_token(
                google_token,
                Request(),
                google_client_id,
            )

            google_email = id_info.get("email")
            full_given = id_info.get("given_name", "").strip()

            parts = full_given.split()

            if parts:
                last_name = parts[0]
                first_name = " ".join(parts[1:]) if len(parts) > 1 else ""
            else:
                first_name = ""
                last_name = ""

            User = get_user_model()

            user = User.objects.filter(email=google_email).first()

            if not user:
                user = User.objects.create_user(
                    username=google_email,
                    email=google_email,
                    first_name=first_name,
                    last_name=last_name,
                    password=make_password(generate_password()),
                )

            return Response(
                {
                    "message": "User logged in with Google successfully",
                    "tokens": get_tokens_for_user(user),
                    "user": {
                        "id": user.id,
                        "email": user.email,
                        "first_name": user.first_name,
                        "last_name": user.last_name,
                        "is_superuser": user.is_superuser,
                    },
                },
                status=status.HTTP_200_OK,
            )

        except ValueError as e:
            return Response(
                {"message": f"Invalid Google token: {str(e)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class LogoutView(APIView):
    # No access token required: an expired access token must not stop the user
    # from revoking their refresh token. The refresh token itself is the proof.
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        refresh = request.data.get("refresh")

        if not refresh:
            return Response(
                {"message": "Refresh token is required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            RefreshToken(refresh).blacklist()
        except TokenError:
            pass  # already expired / blacklisted / invalid: nothing left to revoke

        return Response(
            {"message": "User logged out successfully"},
            status=status.HTTP_200_OK,
        )


class UserView(APIView):
    # Uses the default JWTAuthentication from REST_FRAMEWORK settings.
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user

        return Response(
            {
                "user": {
                    "id": user.id,
                    "email": user.email,
                    "username": user.username,
                    "firstName": user.first_name,
                    "lastName": user.last_name,
                    "is_superuser": user.is_superuser,
                }
            },
            status=status.HTTP_200_OK,
        )

@csrf_exempt
async def railway_plan(request):
    """
    Receive a railway network request from the frontend,
    forward it to the FastAPI QAOA planner, and return its result.
    """

    # Only accept POST requests.
    if request.method != "POST":
        return JsonResponse(
            {"error": "Only POST requests are allowed."},
            status=405
        )

    # ------------------------------------------------------------------
    # 1. Parse incoming JSON
    # ------------------------------------------------------------------

    try:
        payload = json.loads(request.body.decode("utf-8"))

    except (json.JSONDecodeError, UnicodeDecodeError):
        return JsonResponse(
            {"error": "Invalid JSON request body."},
            status=400
        )

    if not isinstance(payload, dict):
        return JsonResponse(
            {"error": "Request body must be a JSON object."},
            status=400
        )

    # ------------------------------------------------------------------
    # 2. Forward request to FastAPI
    # ------------------------------------------------------------------

    planner_url = settings.RAILWAY_PLANNER_URL

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=10.0,
                read=None,
                write=10.0,
                pool=10.0,
            )
        ) as client:

            response = await client.post(
                planner_url,
                json=payload
            )

    except httpx.TimeoutException:
        logger.exception("Connection to railway planner timed out")

        return JsonResponse(
            {"error": "Could not connect to the railway planner in time."},
            status=504
        )

    except httpx.RequestError:
        logger.exception("Could not reach railway planner")

        return JsonResponse(
            {"error": "Railway planner service is unavailable."},
            status=502
        )

    # ------------------------------------------------------------------
    # 3. Parse FastAPI response
    # ------------------------------------------------------------------

    try:
        result = response.json()

    except ValueError:
        logger.error(
            "Railway planner returned invalid JSON. Status: %s",
            response.status_code
        )

        return JsonResponse(
            {"error": "Railway planner returned an invalid response."},
            status=502
        )

    # ------------------------------------------------------------------
    # 4. Return the original result and HTTP status to the frontend
    # ------------------------------------------------------------------

    if isinstance(result, dict):
        return JsonResponse(
            result,
            status=response.status_code,
            json_dumps_params={"ensure_ascii": False}
        )

    return JsonResponse(
        result,
        safe=False,
        status=response.status_code,
        json_dumps_params={"ensure_ascii": False}
    )