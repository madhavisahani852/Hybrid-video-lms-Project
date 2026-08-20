import json
import os
import subprocess
import time
from typing import Dict, List


def probe_video_stream(file_path: str) -> Dict:
    """Probe video stream metadata to check for matching properties."""
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_streams",
        file_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    metadata = json.loads(result.stdout)

    video_stream = next(
        (s for s in metadata.get("streams", []) if s.get("codec_type") == "video"), None
    )
    if not video_stream:
        raise ValueError(f"No video stream found in {file_path}")

    fps = 0.0
    if video_stream.get("r_frame_rate"):
        num, den = video_stream["r_frame_rate"].split("/")
        if num and den and int(den) != 0:
            fps = int(num) / int(den)

    return {
        "width": video_stream.get("width"),
        "height": video_stream.get("height"),
        "fps": round(fps, 2),
        "codec_name": video_stream.get("codec_name"),
        "pix_fmt": video_stream.get("pix_fmt"),
    }


def concatenate_videos(
    video_paths: List[str], master_audio_path: str, output_path: str
):
    """Concatenate multiple video files and merge original master audio in a single pass."""
    if not video_paths:
        raise ValueError("No video paths provided for concatenation")

    # Fast path for single video clip
    if len(video_paths) == 1:
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            video_paths[0],
            "-i",
            master_audio_path,
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-movflags",
            "+faststart",
            "-shortest",
            output_path,
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        return output_path

    concat_list_path = None
    try:
        # Probe all input videos to check if they match perfectly
        metadatas = [probe_video_stream(p) for p in video_paths]
        first_meta = metadatas[0]

        is_mismatch = any(
            m["width"] != first_meta["width"]
            or m["height"] != first_meta["height"]
            or m["fps"] != first_meta["fps"]
            or m["codec_name"] != first_meta["codec_name"]
            or m["pix_fmt"] != first_meta["pix_fmt"]
            for m in metadatas
        )

        cmd = ["ffmpeg", "-y"]

        if not is_mismatch:
            # Mode A: Concat Demuxer (Fast-path stream copy)
            concat_list_path = os.path.join(
                os.path.dirname(output_path), f"concat_list_{int(time.time())}.txt"
            )

            # Create concat list file
            with open(concat_list_path, "w", encoding="utf-8") as f:
                for p in video_paths:
                    safe_path = os.path.abspath(p).replace("'", "'\\''")
                    f.write(f"file '{safe_path}'\n")

            cmd.extend(["-f", "concat", "-safe", "0", "-i", concat_list_path])
            cmd.extend(["-i", master_audio_path])
            cmd.extend(
                [
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:v",
                    "copy",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    "-movflags",
                    "+faststart",
                    "-shortest",
                    output_path,
                ]
            )
        else:
            # Mode B: Filter Complex (Safe-path re-encoding)
            for p in video_paths:
                cmd.extend(["-i", p])
            cmd.extend(["-i", master_audio_path])

            filter_parts = []
            concat_v_inputs = ""

            for i in range(len(video_paths)):
                filter_parts.append(
                    f"[{i}:v]fps=25,scale=1920:1080:force_original_aspect_ratio=decrease,"
                    f"pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v{i}]"
                )
                concat_v_inputs += f"[v{i}]"

            filter_parts.append(
                f"{concat_v_inputs}concat=n={len(video_paths)}:v=1:a=0[vout]"
            )

            cmd.extend(["-filter_complex", "; ".join(filter_parts)])
            cmd.extend(
                [
                    "-map",
                    "[vout]",
                    "-map",
                    f"{len(video_paths)}:a:0",
                    "-c:v",
                    "libx264",
                    "-profile:v",
                    "high",
                    "-level",
                    "4.1",
                    "-crf",
                    "20",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    "-movflags",
                    "+faststart",
                    "-shortest",
                    output_path,
                ]
            )

        subprocess.run(cmd, check=True, capture_output=True)
        return output_path

    finally:
        # Cleanup temporary concat list if it was created
        if concat_list_path and os.path.exists(concat_list_path):
            try:
                os.remove(concat_list_path)
            except Exception:
                pass
