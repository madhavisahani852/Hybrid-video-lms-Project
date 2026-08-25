from datetime import datetime, timezone

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.logging_config import get_logger

logger = get_logger("exceptions")


class ServiceBaseException(Exception):
    def __init__(
        self,
        detail: str,
        error_code: str = "INTERNAL_ERROR",
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
    ):
        self.detail = detail
        self.error_code = error_code
        self.status_code = status_code
        super().__init__(detail)


class ServiceValidationError(ServiceBaseException):
    def __init__(
        self,
        detail: str,
        error_code: str = "VALIDATION_ERROR",
        status_code: int = status.HTTP_400_BAD_REQUEST,
    ):
        super().__init__(detail, error_code=error_code, status_code=status_code)


class StorageError(ServiceBaseException):
    def __init__(self, detail: str = "Failed to store uploaded files safely."):
        super().__init__(
            detail,
            error_code="STORAGE_ERROR",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


class PipelineError(ServiceBaseException):
    def __init__(self, detail: str = "Talking Head pipeline processing failed."):
        super().__init__(
            detail,
            error_code="PIPELINE_ERROR",
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


class JobNotFoundError(ServiceBaseException):
    def __init__(self, job_id: str):
        super().__init__(
            f"Job '{job_id}' not found.",
            error_code="JOB_NOT_FOUND",
            status_code=status.HTTP_404_NOT_FOUND,
        )


def register_exception_handlers(app: FastAPI):

    @app.exception_handler(ServiceBaseException)
    async def custom_base_exception_handler(
        request: Request, exc: ServiceBaseException
    ):
        logger.warning(
            f"Handled custom exception: code={exc.error_code} "
            f"detail={exc.detail} status={exc.status_code}"
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.detail,
                "error_code": exc.error_code,
                "timestamp": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException):
        logger.warning(f"HTTP exception: status={exc.status_code} detail={exc.detail}")
        error_code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": str(exc.detail),
                "error_code": error_code,
                "timestamp": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ):
        logger.warning(f"Request validation failure: {exc.errors()}")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "detail": ("Invalid request parameters or missing required fields."),
                "error_code": "REQUEST_VALIDATION_ERROR",
                "timestamp": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
        )

    @app.exception_handler(Exception)
    async def unexpected_exception_handler(request: Request, exc: Exception):
        logger.error(
            f"Unhandled exception on {request.method} {request.url.path}: " f"{exc}",
            exc_info=True,
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "detail": (
                    "An unexpected internal error occurred. " "Please try again later."
                ),
                "error_code": "INTERNAL_SERVER_ERROR",
                "timestamp": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
            },
        )
