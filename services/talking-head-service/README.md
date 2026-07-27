# AI Talking Head Service

**AvatarStream AI** — A fully free, programmatic AI pipeline that generates 1–3 minute talking-head videos from a text script — no GPU required, runs on any laptop.

## Overview

This service converts a text script (or topic) into a complete talking-head video with:
- A **photo-realistic AI avatar** presenter
- **Neural voice narration** (7+ voices, multiple accents)
- **Lip-synced talking-head animation** via cloud GPU inference
- **1–3 minute duration** with seamless chunk stitching

Everything runs at **$0 total cost** using free-tier cloud APIs and open-source models.

## Quick Start

### Prerequisites

| Dependency | Required | Install |
|------------|----------|---------|
| **Node.js** 18+ | ✅ | `apt install nodejs` or [nodejs.org](https://nodejs.org) |
| **Python 3** | ✅ | `apt install python3 python3-pip` |
| **FFmpeg** | ✅ | `apt install ffmpeg` or `brew install ffmpeg` |
| **edge-tts** (Python) | ✅ | `pip install edge-tts` |

### Local Development

```bash
# 1. Navigate to this directory
cd services/talking-head-service

# 2. Install Node.js dependencies
npm install

# 3. Start the server (development mode with auto-restart)
npm run dev

# Or production mode:
npm start
```

### Environment Variables (All Optional)

Copy `.env.example` to `.env`:

```bash
PORT=3000
GEMINI_API_KEY=       # Google Gemini - AI scriptwriting (free tier)
HF_TOKEN=             # Hugging Face - bypass ZeroGPU queues
COLAB_WORKER_URL=     # Custom GPU worker endpoint
```

## Vercel Deployment

The service is configured for **Vercel Serverless Functions** deployment.

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy from the project root (hybrid-video-lms/services/talking-head-service)
vercel
```

The `vercel.json` config routes all requests through the Express serverless function in `src/server.js`.

### Environment Variables on Vercel

Set these in the Vercel dashboard (Settings → Environment Variables):
- `GEMINI_API_KEY`
- `HF_TOKEN`
- `COLAB_WORKER_URL`

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/voices` | List available TTS voices |
| `POST` | `/api/generate-script` | Generate script from topic |
| `POST` | `/api/generate-avatar` | Generate avatar image from prompt |
| `POST` | `/api/upload-avatar` | Upload custom photo |
| `POST` | `/api/generate-video` | Start full video generation pipeline |
| `GET` | `/api/job-status/:jobId` | Poll video generation progress |

### Example: Generate a Video

```bash
# 1. Generate a script
curl -X POST http://localhost:3000/api/generate-script \
  -H 'Content-Type: application/json' \
  -d '{"topic":"5 productivity hacks","durationMinutes":1}'

# 2. Generate an avatar
curl -X POST http://localhost:3000/api/generate-avatar \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Professional tech presenter, studio lighting"}'

# 3. Generate the video
curl -X POST http://localhost:3000/api/generate-video \
  -H 'Content-Type: application/json' \
  -d '{
    "scriptText": "Your script here...",
    "imagePath": "/tmp/avatar_1234.png"
  }'
```

## Pipeline Architecture

```
Script Input → TTS (edge-tts) → Audio Chunks → Talking-Head Render → FFmpeg Stitch → MP4 Output
```

Each stage has automatic fallbacks to ensure $0 operation at all times.

## Project Structure

```
talking-head-service/
├── public/                    # Static frontend dashboard
│   ├── index.html            # Dashboard UI (script editor, avatar studio, video player)
│   ├── style.css             # Dark-themed responsive styles
│   └── app.js                # Frontend logic (API calls, job polling, settings)
├── src/
│   ├── server.js             # Express API gateway (all routes, job orchestration)
│   └── services/
│       ├── scriptService.js  # Gemini API + fallback template engine
│       ├── ttsService.js     # edge-tts neural voice synthesis
│       ├── avatarService.js  # 3-tier image generation with fallbacks
│       ├── videoService.js   # Hugging Face Gradio client + Colab + FFmpeg fallback
│       └── ffmpegService.js  # Audio splitting, video concatenation
├── package.json              # ES Module project config
├── vercel.json               # Vercel deployment configuration
└── README.md                 # This file
```
