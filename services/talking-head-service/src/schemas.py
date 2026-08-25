from typing import Optional

from pydantic import BaseModel, Field


class GenerateAvatarResponse(BaseModel):
    job_id: str = Field(..., description="Unique job identifier")
    status: str = Field(..., description="Initial job status")
    created_at: str = Field(..., description="ISO timestamp of job creation")
    message: str = Field(..., description="Human-readable status message")

    voice: str = Field(..., description="Voice selected for the avatar")
    avatar: str = Field(..., description="Avatar selected for the voice")
    gender: str = Field(..., description="Gender associated with the voice")


class JobStatusResponse(BaseModel):
    job_id: str = Field(..., description="Unique job identifier")

    status: str = Field(
        ...,
        description="Current job status",
    )

    progress: float = Field(
        0.0,
        ge=0.0,
        le=100.0,
        description="Job completion progress percentage",
    )

    estimated_time_remaining: float = Field(
        0.0,
        ge=0.0,
        description="Estimated time remaining in seconds",
    )

    created_at: str = Field(
        ...,
        description="ISO timestamp of job creation",
    )

    completed_at: Optional[str] = Field(
        None,
        description="ISO timestamp of job completion",
    )

    output_url: Optional[str] = Field(
        None,
        description="Generated video URL",
    )

    error_message: Optional[str] = Field(
        None,
        description="Failure details",
    )

    voice: Optional[str] = Field(
        None,
        description="Voice used for the job",
    )

    avatar: Optional[str] = Field(
        None,
        description="Avatar used for the job",
    )

    gender: Optional[str] = Field(
        None,
        description="Gender associated with the voice",
    )


class ErrorResponse(BaseModel):
    detail: str = Field(
        ...,
        description="User-facing error details",
    )

    error_code: str = Field(
        ...,
        description="Machine-readable error code",
    )

    timestamp: str = Field(
        ...,
        description="ISO timestamp",
    )