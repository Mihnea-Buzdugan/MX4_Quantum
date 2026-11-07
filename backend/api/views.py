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
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.db import IntegrityError
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
from django.db import DatabaseError
from django.db.models import Count, Prefetch, Q
from django.utils import timezone

from .models import PlanEdge, RailwayPlan, SimulationBatch
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

        email = str(data.get("email") or "").strip().lower()
        password = str(data.get("password") or "")
        first_name = str(data.get("first_name") or "").strip()
        last_name = str(data.get("last_name") or "").strip()
        # the frontend uses the email as username; fall back to it when none is sent
        username = str(data.get("username") or email).strip()

        if not email or not password:
            return Response(
                {"message": "Email and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        User = get_user_model()

        if User.objects.filter(email__iexact=email).exists():
            return Response(
                {"message": "An account with this email already exists. Sign in instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if User.objects.filter(username__iexact=username).exists():
            return Response(
                {"message": "Username is already in use."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Django's password rules (length, too common, entirely numeric, too similar to the email)
        try:
            validate_password(password, user=User(email=email, username=username,
                                                  first_name=first_name, last_name=last_name))
        except ValidationError as e:
            return Response(
                {"message": " ".join(e.messages)},
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
        except (ValidationError, IntegrityError):
            return Response(
                {"message": "Could not create the account; the email or username may already be in use."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {
                "message": "User created and logged in successfully.",
                "tokens": get_tokens_for_user(user),
                "user": {
                    "id": user.id,
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
        email = str(request.data.get("email") or "").strip()
        password = str(request.data.get("password") or "")

        if not email or not password:
            return Response(
                {"message": "Email and password are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # emails are matched case-insensitively (older accounts may have been saved with capitals)
        existing = get_user_model().objects.filter(email__iexact=email).first()
        user = authenticate(
            request,
            username=existing.email if existing else email,  # USERNAME_FIELD is "email"
            password=password,
        )

        if user is None:
            return Response(
                {"message": "Wrong email or password."},
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

            google_email = (id_info.get("email") or "").strip().lower()
            if not google_email:
                return Response(
                    {"message": "Your Google account did not share an email address."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Google sends the first name(s) as given_name and the last name as family_name
            first_name = (id_info.get("given_name") or "").strip()
            last_name = (id_info.get("family_name") or "").strip()

            User = get_user_model()

            user = User.objects.filter(email__iexact=google_email).first()

            if not user:
                # Google-only account: a random password it never needs (create_user hashes it)
                user = User.objects.create_user(
                    username=google_email,
                    email=google_email,
                    first_name=first_name,
                    last_name=last_name,
                    password=generate_password(32),
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

    # Batch runs: which batch and which simulation number (database only, like `algorithm`).
    batch_id = payload.pop("batch_id", None)
    batch_index = payload.pop("batch_index", None)
    batch = None
    if user is not None and batch_id is not None:
        try:
            batch = await SimulationBatch.objects.filter(pk=batch_id, user=user).afirst()
        except DatabaseError:
            return _database_error()
        if batch is None:
            return _json({"error": "Batch not found."}, status=404)
    try:
        batch_index = int(batch_index) if batch_index is not None else None
    except (TypeError, ValueError):
        batch_index = None

    async def save(data, http_status):
        """Save the run for the logged-in user; never breaks the response to the frontend."""
        if user is None:
            return None
        try:
            data = {**data}
            data.setdefault("budget", payload.get("budget"))
            # from_response uses transaction.atomic, which is sync-only
            plan = await sync_to_async(RailwayPlan.from_response)(
                user=user,
                data=data,
                algorithm=algorithm,
                execution_ms=(time.perf_counter() - started_at) * 1000,
                request_data=payload,
                batch=batch,
                batch_index=batch_index,
                http_status=http_status,
            )
            return plan.pk
        except Exception:
            logger.exception("Could not save railway plan")
            return None

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
        message = "Could not connect to the railway planner in time."
        await save({"status": "error", "reason": message}, 504)
        return _json({"error": message}, status=504)

    except httpx.RequestError:
        logger.exception("Could not reach railway planner")
        message = "Railway planner service is unavailable."
        await save({"status": "error", "reason": message}, 502)
        return _json({"error": message}, status=502)

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
        message = "Railway planner returned an invalid response."
        await save({"status": "error", "reason": message}, 502)
        return _json({"error": message}, status=502)

    # ------------------------------------------------------------------
    # 4. Save every run for the logged-in user (also infeasible, pending,
    #    no-valid-sample and failed runs), so it shows up in the run history.
    # ------------------------------------------------------------------

    if isinstance(result, dict) and result.get("status") in RailwayPlan.Status.values:
        plan_id = await save(result, response.status_code)
    else:
        # FastAPI error: {"detail": "..."} or a validation list
        detail = result.get("detail") if isinstance(result, dict) else result
        message = detail if isinstance(detail, str) else json.dumps(detail, ensure_ascii=False)
        plan_id = await save(
            {"status": "error", "reason": f"HTTP {response.status_code}: {message}"[:4000]},
            response.status_code,
        )
    if plan_id is not None and isinstance(result, dict):
        result["plan_id"] = plan_id

    # ------------------------------------------------------------------
    # 5. Return the original result and HTTP status to the frontend
    # ------------------------------------------------------------------

    if isinstance(result, dict):
        return _json(result, status=response.status_code)

    return _json(result, safe=False, status=response.status_code)


async def plan_list(request):
    """GET /api/plans/ -> the current user's saved plans (summaries).

    ?scope=single  only runs started on their own (not part of a batch)
    ?scope=batch   only batch runs
    """

    if request.method != "GET":
        return _json({"error": "Only GET requests are allowed."}, status=405)

    try:
        user = await _authenticate(request)
    except AuthenticationFailed:
        return _json({"error": "Invalid or expired token."}, status=401)
    if user is None:
        return _json({"error": "Authentication required."}, status=401)

    scope = request.GET.get("scope")

    def load():
        plans = RailwayPlan.objects.filter(user=user)
        if scope == "single":
            plans = plans.filter(batch__isnull=True)
        elif scope == "batch":
            plans = plans.filter(batch__isnull=False)
        # the quantum diagnostics are only needed in the detail view
        plans = plans.defer("quantum_stats", "conflict_pairs", "notes")
        rows = []
        for plan in plans:
            try:
                rows.append(plan.summary())
            except Exception:  # one damaged run must not hide all the others
                logger.exception("Could not read saved plan %s", plan.pk)
                rows.append(plan.fallback_summary())
        return rows

    try:
        rows = await sync_to_async(load)()
    except DatabaseError:
        return _database_error()
    return _json(rows, safe=False)


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
        plan = await _plans_with_graph().aget(pk=pk, user=user)
    except RailwayPlan.DoesNotExist:
        return _json({"error": "Plan not found."}, status=404)
    except DatabaseError:
        return _database_error()

    if request.method == "DELETE":
        await plan.adelete()
        return HttpResponse(status=204)

    try:
        return _json(await sync_to_async(plan.to_response)())
    except DatabaseError:
        return _database_error()
    except Exception:
        logger.exception("Could not read saved plan %s", plan.pk)
        return _json({"error": "This saved run could not be read."}, status=500)


MIGRATION_HINT = (
    "The run-history tables are not up to date. Run `python manage.py migrate` "
    "in the backend folder and restart Django."
)


def _database_error():
    """A query failed, almost always because migration 0004 was not applied yet."""
    logger.exception("Run history query failed")
    return _json({"error": MIGRATION_HINT}, status=503)


def _plans_with_graph():
    """Plans with nodes and edges loaded in a few queries (to_response uses .all())."""
    return RailwayPlan.objects.prefetch_related(
        "nodes",
        Prefetch("edges", queryset=PlanEdge.objects.select_related("from_node", "to_node")),
    )


async def _require_user(request):
    """(user, None) or (None, error response)."""
    try:
        user = await _authenticate(request)
    except AuthenticationFailed:
        return None, _json({"error": "Invalid or expired token."}, status=401)
    if user is None:
        return None, _json({"error": "Authentication required."}, status=401)
    return user, None


def _read_json(request):
    try:
        data = json.loads(request.body.decode("utf-8") or "{}")
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return data if isinstance(data, dict) else None


# ----------------------------------------------------------------------------- batches

@csrf_exempt
async def batch_list(request):
    """GET  /api/batches/ -> the user's batches (newest first, with run counts).
    POST /api/batches/ -> create a batch before its runs start:
         {name?, algorithm, budget, nodes: [...], routes: [...], runs: [{p, slack, iterations, shots, seed}, ...]}
    """

    if request.method not in ("GET", "POST"):
        return _json({"error": "Only GET and POST requests are allowed."}, status=405)
    user, error = await _require_user(request)
    if error:
        return error

    if request.method == "POST":
        data = _read_json(request)
        if data is None:
            return _json({"error": "Request body must be a JSON object."}, status=400)
        runs = data.get("runs")
        if not isinstance(runs, list) or not runs:
            return _json({"error": "`runs` must be a non-empty list."}, status=400)
        try:
            budget = float(data.get("budget"))
        except (TypeError, ValueError):
            return _json({"error": "`budget` must be a number."}, status=400)
        try:
            batch = await SimulationBatch.objects.acreate(
                user=user,
                name=str(data.get("name") or "")[:120],
                algorithm=str(data.get("algorithm") or "")[:60],
                budget=budget,
                nodes=data.get("nodes") if isinstance(data.get("nodes"), list) else [],
                routes=data.get("routes") if isinstance(data.get("routes"), list) else [],
                runs=runs,
            )
        except DatabaseError:
            return _database_error()
        return _json(batch.summary(saved=0, valid=0), status=201)

    def load():
        batches = SimulationBatch.objects.filter(user=user).annotate(
            saved=Count("plans"),
            valid=Count(
                "plans",
                filter=Q(plans__status=RailwayPlan.Status.OK, plans__connected=True),
            ),
        )
        return [b.summary(saved=b.saved, valid=b.valid) for b in batches]

    try:
        return _json(await sync_to_async(load)(), safe=False)
    except DatabaseError:
        return _database_error()


@csrf_exempt
async def batch_detail(request, pk):
    """GET    /api/batches/<id>/ -> the batch with every saved run (full planner responses).
    PATCH  /api/batches/<id>/ -> {status?, statistics?, name?} (sent when the batch ends)
    DELETE /api/batches/<id>/ -> delete the batch and its runs.
    """

    if request.method not in ("GET", "PATCH", "DELETE"):
        return _json({"error": "Only GET, PATCH and DELETE requests are allowed."}, status=405)
    user, error = await _require_user(request)
    if error:
        return error

    try:
        batch = await SimulationBatch.objects.aget(pk=pk, user=user)
    except SimulationBatch.DoesNotExist:
        return _json({"error": "Batch not found."}, status=404)
    except DatabaseError:
        return _database_error()

    if request.method == "DELETE":
        await batch.adelete()
        return HttpResponse(status=204)

    if request.method == "PATCH":
        data = _read_json(request)
        if data is None:
            return _json({"error": "Request body must be a JSON object."}, status=400)
        if "status" in data:
            if data["status"] not in SimulationBatch.Status.values:
                return _json({"error": "Unknown status."}, status=400)
            batch.status = data["status"]
            if batch.status != SimulationBatch.Status.RUNNING:
                batch.finished_at = timezone.now()
        if "statistics" in data:
            batch.statistics = data["statistics"]
        if "name" in data:
            batch.name = str(data["name"] or "")[:120]
        await batch.asave()
        return _json(batch.summary())

    def load():
        plans = list(_plans_with_graph().filter(batch=batch).order_by("batch_index", "created_at"))
        result = batch.summary(
            saved=len(plans),
            valid=sum(1 for p in plans if p.is_valid),
        )
        result["routes"] = batch.routes if isinstance(batch.routes, list) else []
        result["runs"] = batch.runs if isinstance(batch.runs, list) else []
        result["plans"] = []
        for p in plans:
            try:
                result["plans"].append(p.to_response())
            except Exception:  # skip a damaged run instead of failing the whole batch
                logger.exception("Could not read saved plan %s", p.pk)
        return result

    try:
        return _json(await sync_to_async(load)())
    except DatabaseError:
        return _database_error()
