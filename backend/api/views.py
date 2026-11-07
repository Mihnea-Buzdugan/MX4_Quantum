import json
import logging
import os
import secrets
import string

import httpx
from asgiref.sync import sync_to_async
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
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework.exceptions import AuthenticationFailed
from .models import RailwayPlan
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
import time

from django.http import HttpResponse, JsonResponse   # was: only JsonResponse

logger = logging.getLogger(__name__)

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


_jwt = JWTAuthentication()


def _json(data, status=200, safe=True):
    return JsonResponse(
        data,
        safe=safe,
        status=status,
        json_dumps_params={"ensure_ascii": False},
    )


@sync_to_async
def _authenticate(request):
    """
    Validate the 'Authorization: Bearer <access token>' header.

    Returns the user, or None when no Authorization header was sent.
    Raises AuthenticationFailed when a token was sent but is invalid/expired
    (the frontend's authFetch then refreshes the token and retries).
    Sync because JWTAuthentication loads the user from the database.
    """
    result = _jwt.authenticate(request)
    return result[0] if result else None


@csrf_exempt
async def railway_plan(request):
    """
    Receive a railway network request from the frontend,
    forward it to the FastAPI QAOA planner, save the result for the
    logged-in user, and return the planner's result.
    """

    # Only accept POST requests.
    if request.method != "POST":
        return _json({"error": "Only POST requests are allowed."}, status=405)

    # ------------------------------------------------------------------
    # 0. Authenticate (JWT). Done first so an expired token is rejected
    #    with 401 BEFORE the slow planner runs, and the frontend can
    #    refresh the token and retry.
    # ------------------------------------------------------------------

    try:
        user = await _authenticate(request)
    except AuthenticationFailed:
        return _json({"error": "Invalid or expired token."}, status=401)

    # ------------------------------------------------------------------
    # 1. Parse incoming JSON
    # ------------------------------------------------------------------

    try:
        payload = json.loads(request.body.decode("utf-8"))

    except (json.JSONDecodeError, UnicodeDecodeError):
        return _json({"error": "Invalid JSON request body."}, status=400)

    if not isinstance(payload, dict):
        return _json({"error": "Request body must be a JSON object."}, status=400)

    # Optional label sent by the frontend (e.g. "Classic Algorithm").
    # It is for our database only, so remove it before calling FastAPI.
    algorithm = str(payload.pop("algorithm", "") or "")

    # ------------------------------------------------------------------
    # 2. Forward request to FastAPI
    # ------------------------------------------------------------------

    planner_url = settings.RAILWAY_PLANNER_URL
    started_at = time.perf_counter()

    try:
        async with httpx.AsyncClient(
                timeout=httpx.Timeout(
                    connect=10.0,
                    read=None,
                    write=10.0,
                    pool=10.0,
                )
        ) as client:

            response = await client.post(planner_url, json=payload)

    except httpx.TimeoutException:
        logger.exception("Connection to railway planner timed out")
        return _json(
            {"error": "Could not connect to the railway planner in time."},
            status=504,
        )

    except httpx.RequestError:
        logger.exception("Could not reach railway planner")
        return _json(
            {"error": "Railway planner service is unavailable."},
            status=502,
        )

    execution_ms = (time.perf_counter() - started_at) * 1000

    # ------------------------------------------------------------------
    # 3. Parse FastAPI response
    # ------------------------------------------------------------------

    try:
        result = response.json()

    except ValueError:
        logger.error(
            "Railway planner returned invalid JSON. Status: %s",
            response.status_code,
        )
        return _json(
            {"error": "Railway planner returned an invalid response."},
            status=502,
        )

    # ------------------------------------------------------------------
    # 4. Save the plan for the logged-in user
    #    A failure here must never break the response to the frontend.
    #    Note: infeasible results come back as HTTP 422 from FastAPI
    #    (the frontend treats that as a normal result), so 422 is saved too.
    # ------------------------------------------------------------------

    if (
            user is not None
            and response.status_code in (200, 422)
            and isinstance(result, dict)
            and result.get("status") in RailwayPlan.Status.values
    ):
        try:
            data = {**result}
            data.setdefault("budget", payload.get("budget"))

            # from_response uses transaction.atomic, which is sync-only
            plan = await sync_to_async(RailwayPlan.from_response)(
                user=user,
                data=data,
                algorithm=algorithm,
                execution_ms=execution_ms,
            )
            result["plan_id"] = plan.pk

        except Exception:
            logger.exception("Could not save railway plan")

    # ------------------------------------------------------------------
    # 5. Return the original result and HTTP status to the frontend
    # ------------------------------------------------------------------

    if isinstance(result, dict):
        return _json(result, status=response.status_code)

    return _json(result, safe=False, status=response.status_code)


async def plan_list(request):
    """GET /api/plans/ -> the current user's saved plans (summaries)."""

    if request.method != "GET":
        return _json({"error": "Only GET requests are allowed."}, status=405)

    try:
        user = await _authenticate(request)
    except AuthenticationFailed:
        return _json({"error": "Invalid or expired token."}, status=401)
    if user is None:
        return _json({"error": "Authentication required."}, status=401)

    plans = [
        {
            "id": p.pk,
            "created_at": p.created_at.isoformat(),
            "algorithm": p.algorithm,
            "status": p.status,
            "connected": p.connected,
            "budget": p.budget,
            "total_cost": p.total_cost,
            "total_value": p.total_value,
        }
        async for p in RailwayPlan.objects.filter(user=user)
    ]
    return _json(plans, safe=False)


# csrf_exempt is safe here: auth is a Bearer header, which browsers never
# attach automatically, so CSRF does not apply (Django's middleware would
# otherwise reject DELETE requests that have no CSRF token).
@csrf_exempt
async def plan_detail(request, pk):
    """GET /api/plans/<id>/ -> full saved plan (same shape as the planner response).
    DELETE /api/plans/<id>/ -> delete it.
    """

    if request.method not in ("GET", "DELETE"):
        return _json({"error": "Only GET and DELETE requests are allowed."}, status=405)

    try:
        user = await _authenticate(request)
    except AuthenticationFailed:
        return _json({"error": "Invalid or expired token."}, status=401)
    if user is None:
        return _json({"error": "Authentication required."}, status=401)

    try:
        plan = await RailwayPlan.objects.aget(pk=pk, user=user)
    except RailwayPlan.DoesNotExist:
        return _json({"error": "Plan not found."}, status=404)

    if request.method == "DELETE":
        await plan.adelete()
        return HttpResponse(status=204)

    return _json(await sync_to_async(plan.to_response)())