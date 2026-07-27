import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

import { generateScriptAndPrompt } from './services/scriptService.js';
import { generateTTSAudio, VOICES } from './services/ttsService.js';
import { generateAvatarImage } from './services/avatarService.js';
import { renderTalkingHeadChunk } from './services/videoService.js';
import { splitAudioIntoChunks, concatenateVideos, getAudioDuration } from './services/ffmpegService.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Directories setup
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
const TMP_DIR = path.join(ROOT_DIR, 'tmp');

fs.ensureDirSync(OUTPUT_DIR);
fs.ensureDirSync(TMP_DIR);

app.use(express.static(PUBLIC_DIR));
app.use('/output', express.static(OUTPUT_DIR));

// File Upload Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => cb(null, `upload_${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

// In-Memory Job Store
const JOBS = new Map();

/**
 * GET /api/voices - List Available Voices
 */
app.get('/api/voices', (req, res) => {
  res.json({ voices: VOICES });
});

/**
 * POST /api/generate-script - Script & Prompt AI Generator
 */
app.post('/api/generate-script', async (req, res) => {
  try {
    const { topic, durationMinutes = 1, targetAudience = 'general', apiKey } = req.body;
    if (!topic) {
      return res.status(400).json({ error: 'Topic is required' });
    }
    const result = await generateScriptAndPrompt({ topic, durationMinutes, targetAudience, apiKey });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[API] Script generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/generate-avatar - AI Presenter Avatar Image Generator
 */
app.post('/api/generate-avatar', async (req, res) => {
  try {
    const { prompt } = req.body;
    const filename = `avatar_${Date.now()}.png`;
    const outputPath = path.join(TMP_DIR, filename);

    await generateAvatarImage(prompt, outputPath);
    
    res.json({ success: true, imagePath: outputPath, filename });
  } catch (err) {
    console.error('[API] Avatar generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/upload-avatar - Custom Avatar Image Upload
 */
app.post('/api/upload-avatar', upload.single('avatarFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image file uploaded' });
  }
  res.json({
    success: true,
    imagePath: req.file.path,
    filename: req.file.filename
  });
});

/**
 * POST /api/generate-video - Trigger 1-3 Min AI Talking-Head Pipeline
 */
app.post('/api/generate-video', async (req, res) => {
  try {
    const { scriptText, imagePath, voice = 'en-US-ChristopherNeural', hfToken, colabUrl } = req.body;

    if (!scriptText || !imagePath) {
      return res.status(400).json({ error: 'scriptText and imagePath are required' });
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const jobDir = path.join(TMP_DIR, jobId);
    await fs.ensureDir(jobDir);

    // Initialize Job State
    JOBS.set(jobId, {
      id: jobId,
      status: 'processing',
      stage: 'Generating Neural Audio (Edge-TTS)',
      progress: 10,
      createdAt: new Date().toISOString(),
      finalVideoUrl: null,
      error: null
    });

    // Send immediate job acceptance response to client
    res.json({ success: true, jobId });

    // Execute Pipeline Async in Background
    (async () => {
      try {
        const job = JOBS.get(jobId);
        const masterAudioPath = path.join(jobDir, 'master_audio.mp3');

        // 1. Generate Full Audio Script
        job.stage = 'Synthesizing Audio Narration...';
        job.progress = 20;
        await generateTTSAudio(scriptText, masterAudioPath, voice);

        // 2. Audio Chunker (Split into ~20s sub-clips)
        job.stage = 'Processing Audio Chunks for Lip Sync...';
        job.progress = 40;
        const chunksDir = path.join(jobDir, 'audio_chunks');
        const audioChunks = await splitAudioIntoChunks(masterAudioPath, chunksDir, 20);

        // 3. Render Talking Head per Chunk
        const videoChunks = [];
        const totalChunks = audioChunks.length;

        for (let i = 0; i < totalChunks; i++) {
          job.stage = `Rendering Talking-Head Clip (${i + 1}/${totalChunks})...`;
          job.progress = 40 + Math.floor(((i + 1) / totalChunks) * 40);

          const chunkAudio = audioChunks[i];
          const chunkVideoOut = path.join(jobDir, `video_chunk_${i}.mp4`);

          await renderTalkingHeadChunk({
            imagePath,
            audioPath: chunkAudio,
            outputPath: chunkVideoOut,
            hfToken,
            colabUrl
          });

          videoChunks.push(chunkVideoOut);
        }

        // 4. Concatenate Video Clips & Merge Master Audio
        job.stage = 'Stitching Master Video & Audio Tracks...';
        job.progress = 90;

        const finalFilename = `talking_head_${jobId}.mp4`;
        const finalOutputPath = path.join(OUTPUT_DIR, finalFilename);

        await concatenateVideos(videoChunks, masterAudioPath, finalOutputPath);

        job.status = 'completed';
        job.stage = 'Video Render Complete!';
        job.progress = 100;
        job.finalVideoUrl = `/output/${finalFilename}`;

        console.log(`[Job ${jobId}] Finished successfully -> ${job.finalVideoUrl}`);

      } catch (err) {
        console.error(`[Job ${jobId}] Failed:`, err);
        const job = JOBS.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = err.message;
          job.stage = 'Generation Failed';
        }
      }
    })();

  } catch (err) {
    console.error('[API] Generate video trigger error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/job-status/:jobId - Poll Job Status
 */
app.get('/api/job-status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = JOBS.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(job);
});

// Serve temporary images
app.use('/tmp', express.static(TMP_DIR));

// Global error handlers to prevent server crashes from async pipeline rejections
process.on('unhandledRejection', (err) => {
  console.error('[Server] Unhandled Rejection (non-fatal):', err?.message || err);
});

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception (non-fatal):', err?.message || err);
});

// ============================================================
// VERCEL COMPATIBILITY
// ============================================================
// When deployed to Vercel, we export the Express app as a 
// serverless function. For local development, we listen on a port.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` AI Talking-Head Video Server running on http://localhost:${PORT}`);
    console.log(` 100% Free ($0) Low-End Hardware Optimized Pipeline`);
    console.log(`=======================================================`);
  });
}

export default app;
