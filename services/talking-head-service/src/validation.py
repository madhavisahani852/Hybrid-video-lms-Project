from pathlib import Path

import cv2
import numpy as np
from fastapi import UploadFile

from src.config import (
    ALLOWED_AUDIO_EXTENSIONS,
    ALLOWED_IMAGE_EXTENSIONS,
    ALLOWED_IMAGE_MIME_TYPES,
    MAX_AUDIO_SIZE_BYTES,
    MAX_IMAGE_SIZE_BYTES,
    SUPPORTED_MODELS,
)
from src.exceptions import ServiceValidationError
from src.logging_config import get_logger

logger = get_logger("validation")


def validate_model(model: str) -> str:
    """Validates requested model against supported models."""
    if not model or model.strip().lower() not in SUPPORTED_MODELS:
        logger.warning(f"Validation failed: unsupported model '{model}'")
        models_str = sorted(list(SUPPORTED_MODELS))
        raise ServiceValidationError(
            detail=f"Model '{model}' is not supported. Supported models: {models_str}",
            error_code="UNSUPPORTED_MODEL",
        )
    return model.strip().lower()


async def validate_image_file(upload_file: UploadFile) -> bytes:
    """Validates uploaded face image for size, extension, and content."""
    if not upload_file or not upload_file.filename:
        logger.warning("Validation failed: missing face_image upload")
        raise ServiceValidationError("face_image file is required.")

    # Read content bytes
    content = await upload_file.read()
    await upload_file.seek(0)

    if len(content) == 0:
        logger.warning(f"Validation failed: empty face_image '{upload_file.filename}'")
        raise ServiceValidationError(
            "face_image file is empty.", error_code="EMPTY_FILE"
        )

    if len(content) > MAX_IMAGE_SIZE_BYTES:
        logger.warning(
            f"Validation failed: face_image size {len(content)} "
            f"exceeds limit {MAX_IMAGE_SIZE_BYTES}"
        )
        raise ServiceValidationError(
            f"face_image file size ({len(content)} bytes) exceeds maximum "
            f"limit of {MAX_IMAGE_SIZE_BYTES} bytes.",
            error_code="FILE_TOO_LARGE",
        )

    # Check extension
    ext = Path(upload_file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        logger.warning(
            f"Validation failed: unsupported image extension '{ext}' "
            f"for file '{upload_file.filename}'"
        )
        allowed_exts = sorted(list(ALLOWED_IMAGE_EXTENSIONS))
        raise ServiceValidationError(
            f"Unsupported image extension '{ext}'. "
            f"Allowed extensions: {allowed_exts}",
            error_code="UNSUPPORTED_IMAGE_FORMAT",
        )

    # Check content-type if present
    content_type = upload_file.content_type
    if content_type and content_type.lower() not in ALLOWED_IMAGE_MIME_TYPES:
        if content_type.lower() != "application/octet-stream":
            logger.warning(
                f"Validation failed: unsupported image content-type "
                f"'{content_type}'"
            )
            raise ServiceValidationError(
                f"Unsupported image content-type '{content_type}'.",
                error_code="UNSUPPORTED_IMAGE_FORMAT",
            )

    # Decode image using OpenCV to verify image content integrity
    try:
        nparr = np.frombuffer(content, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None or img.size == 0:
            logger.warning(
                f"Validation failed: cv2 failed to decode image "
                f"'{upload_file.filename}'"
            )
            raise ServiceValidationError(
                "face_image file is corrupted or not a valid decodable image.",
                error_code="CORRUPTED_IMAGE",
            )
    except Exception as e:
        if isinstance(e, ServiceValidationError):
            raise
        logger.warning(
            f"Validation exception decoding image " f"'{upload_file.filename}': {e}"
        )
        raise ServiceValidationError(
            "face_image file is corrupted or invalid.",
            error_code="CORRUPTED_IMAGE",
        )

    return content


async def validate_audio_file(upload_file: UploadFile) -> bytes:
    """Validates uploaded audio file for size, extension, and content."""
    if not upload_file or not upload_file.filename:
        logger.warning("Validation failed: missing audio upload")
        raise ServiceValidationError("audio file is required.")

    # Read content bytes
    content = await upload_file.read()
    await upload_file.seek(0)

    if len(content) == 0:
        logger.warning(f"Validation failed: empty audio file '{upload_file.filename}'")
        raise ServiceValidationError("audio file is empty.", error_code="EMPTY_FILE")

    if len(content) > MAX_AUDIO_SIZE_BYTES:
        logger.warning(
            f"Validation failed: audio size {len(content)} "
            f"exceeds limit {MAX_AUDIO_SIZE_BYTES}"
        )
        raise ServiceValidationError(
            f"audio file size ({len(content)} bytes) exceeds maximum "
            f"limit of {MAX_AUDIO_SIZE_BYTES} bytes.",
            error_code="FILE_TOO_LARGE",
        )

    # Check extension
    ext = Path(upload_file.filename).suffix.lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        logger.warning(
            f"Validation failed: unsupported audio extension '{ext}' "
            f"for file '{upload_file.filename}'"
        )
        allowed_exts = sorted(list(ALLOWED_AUDIO_EXTENSIONS))
        raise ServiceValidationError(
            f"Unsupported audio extension '{ext}'. "
            f"Allowed extensions: {allowed_exts}",
            error_code="UNSUPPORTED_AUDIO_FORMAT",
        )

    # Magic header check for audio formats
    is_valid_header = False
    if ext == ".wav" or (content.startswith(b"RIFF") and b"WAVE" in content[:16]):
        is_valid_header = content.startswith(b"RIFF") and b"WAVE" in content[:16]
    elif (
        ext == ".mp3"
        or content.startswith(b"ID3")
        or content[:2] in [b"\xff\xfb", b"\xff\xf3", b"\xff\xf2"]
    ):
        is_valid_header = True
    elif (
        ext in [".ogg", ".flac", ".m4a"]
        or content.startswith(b"OggS")
        or content.startswith(b"fLaC")
        or b"ftyp" in content[:32]
    ):
        is_valid_header = True

    if not is_valid_header:
        logger.warning(
            f"Validation failed: audio file '{upload_file.filename}' "
            f"failed magic header check"
        )
        raise ServiceValidationError(
            "audio file is corrupted or not a valid audio format.",
            error_code="CORRUPTED_AUDIO",
        )

    return content
