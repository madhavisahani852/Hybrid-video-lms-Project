import { Client, handle_file } from '@gradio/client';
import fs from 'fs-extra';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import { getAudioDuration } from './ffmpegService.js';

/**
 * Talking-Head AI Video Generation Service
 * Supports:
 * 1. Hugging Face Spaces API via @gradio/client (Free, zero cost, audio-driven)
 * 2. Custom Colab / Kaggle Worker API (Free GPU fallback)
 * 3. Local Dynamic Motion Preview (Ensures 100% operational uptime)
 */

// Pre-defined candidate spaces for audio-driven talking head generation
// Each accepts a source image + audio file and returns a video with lipsync
// Only confirmed-working spaces are included to avoid unnecessary connection timeouts
const CANDIDATE_SPACES = [
  {
    // SadTalker: Audio-driven talking face animation
    // Takes: source_image, driven_audio -> outputs talking head video with head motion & lipsync
    space: 'kevinwang676/SadTalker',
    // Unnamed endpoint (ID "0") with positional parameters:
    // [source_image, driven_audio, preprocess, still_mode, gfpgan_enhancer, batch_size, resolution, pose_style]
    buildPayload: (img, aud) => [
      handle_file(img),  // Source image (filepath)
      handle_file(aud),  // Input audio (filepath)
      'full',            // preprocess: crop/resize/full
      false,             // Still Mode: fewer hand motion
      false,             // GFPGAN as Face enhancer
      2,                 // batch size in generation
      256,               // face model resolution
      0                  // Pose style (0-46)
    ]
  }
];

/**
 * Extract video URL from Gradio prediction result
 */
function extractVideoUrl(result) {
  // Result can have different structures depending on Gradio version
  if (!result?.data) return null;
  
  for (const item of result.data) {
    if (!item) continue;
    // File with URL
    if (item.url) return item.url;
    // File with path
    if (item.path) return item.path;
    // File with name and data (base64)
    if (item.name && item.data) return item.name;
    // Direct string URL
    if (typeof item === 'string' && (item.startsWith('http') || item.startsWith('/'))) return item;
  }
  return null;
}

/**
 * Helper: run a promise with a timeout
 */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms))
  ]);
}

/**
 * Try a single Hugging Face Space for talking head inference
 */
async function tryHFSpace(spaceConfig, imagePath, audioPath, outputPath, hfToken) {
  const { space, buildPayload } = spaceConfig;
  console.log(`[VideoService] Connecting to Hugging Face Space: ${space}...`);
  
  // Set a 60-second timeout for the entire HF Space operation
  // Free spaces often take time to wake up from sleep
  const HF_TIMEOUT_MS = 60000;
  
  const client = await withTimeout(
    Client.connect(space, { hf_token: hfToken }),
    HF_TIMEOUT_MS,
    `Connecting to ${space}`
  );
  
  const payload = buildPayload(imagePath, audioPath);
  
  // Unnamed endpoints use fn_index (0) instead of a string name like '/predict'
  const result = await withTimeout(
    client.predict(0, payload),
    HF_TIMEOUT_MS,
    `Predict on ${space}`
  );
  const videoUrl = extractVideoUrl(result);
  
  if (!videoUrl) {
    throw new Error(`No video URL in response from ${space}`);
  }
  
  console.log(`[VideoService] Downloading result from ${videoUrl}`);
  const res = await fetch(videoUrl);
  if (!res.ok) {
    throw new Error(`Failed to download video: ${res.status}`);
  }
  
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 1000) {
    throw new Error(`Downloaded file too small (${buffer.byteLength} bytes)`);
  }
  
  await fs.ensureDir(path.dirname(outputPath));
  await fs.writeFile(outputPath, Buffer.from(buffer));
  return { success: true, method: `hf:${space}`, outputPath };
}

/**
 * Create an animated talking-head preview using FFmpeg
 * Simulates facial motion with subtle zoom, pan, and color effects
 */
function generateMotionPreview(imagePath, audioPath, outputPath, audioDuration) {
  return new Promise((resolve, reject) => {
    fs.ensureDirSync(path.dirname(outputPath));
    
    // Build a smooth Ken Burns zoom effect and color grading
    // to make the avatar feel alive even without cloud GPU inference
    const duration = audioDuration || 10;
    const safeDuration = Math.max(duration, 2);
    
    // Subtle zoom animation (1.0x -> 1.03x over the clip duration)
    const frameCount = Math.ceil(safeDuration * 25);
    const zoomPan = `zoompan=z='min(zoom(1.0)+0.0003,1.03)':d=${frameCount}:s=768x768:fps=25`;
    
    // Complete filter chain: scale -> pad -> format -> zoom -> color grading
    const filterChain = [
      `scale=768:768:force_original_aspect_ratio=decrease`,
      `pad=768:768:(ow-iw)/2:(oh-ih)/2`,
      `format=yuv420p`,
      `${zoomPan}`,
      `colorlevels=rimin=0.05:gimin=0.05:bimin=0.05:rimax=0.95:gimax=0.95:bimax=0.95`,
      `eq=brightness=0.02:saturation=1.1`
    ].join(',');
    
    ffmpeg()
      .input(imagePath)
      .loop(1)
      .input(audioPath)
      .videoFilter(filterChain)
      .outputOptions([
        '-c:v libx264',
        '-preset medium',
        '-crf 23',
        '-c:a aac',
        '-b:a 192k',
        '-pix_fmt yuv420p',
        '-shortest',
        '-movflags +faststart'
      ])
      .output(outputPath)
      .on('end', () => {
        console.log('[VideoService] Motion preview generated successfully');
        resolve({ success: true, method: 'motion_preview', outputPath });
      })
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Render talking head video from avatar image + audio narration
 */
export async function renderTalkingHeadChunk({ imagePath, audioPath, outputPath, hfToken = '', colabUrl = '' }) {
  // Validate inputs
  if (!imagePath || !fs.existsSync(imagePath)) {
    throw new Error(`Image path does not exist: ${imagePath}`);
  }
  if (!audioPath || !fs.existsSync(audioPath)) {
    throw new Error(`Audio path does not exist: ${audioPath}`);
  }

  // Option A: Use Custom Colab / Kaggle Worker Endpoint if specified
  const customColab = colabUrl || process.env.COLAB_WORKER_URL;
  if (customColab) {
    try {
      console.log(`[VideoService] Delegating inference to custom Colab worker at ${customColab}...`);
      const imgData = await fs.readFile(imagePath);
      const audData = await fs.readFile(audioPath);

      const formData = new FormData();
      formData.append('image', new Blob([imgData]), 'avatar.png');
      formData.append('audio', new Blob([audData]), 'narration.mp3');

      const response = await fetch(`${customColab.replace(/\/$/, '')}/predict`, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const buffer = await response.arrayBuffer();
        await fs.ensureDir(path.dirname(outputPath));
        await fs.writeFile(outputPath, Buffer.from(buffer));
        return { success: true, method: 'colab', outputPath };
      }
      console.warn(`[VideoService] Colab worker returned ${response.status}, trying fallbacks...`);
    } catch (err) {
      console.warn(`[VideoService] Colab Worker call failed: ${err.message}. Trying HF Spaces...`);
    }
  }

  // Option B: Hugging Face Spaces (audio-driven talking-head)
  const token = hfToken || process.env.HF_TOKEN || undefined;
  
  for (const spaceConfig of CANDIDATE_SPACES) {
    try {
      const result = await tryHFSpace(spaceConfig, imagePath, audioPath, outputPath, token);
      console.log(`[VideoService] ✅ Success with ${result.method}`);
      return result;
    } catch (err) {
      console.warn(`[VideoService] ${spaceConfig.space} failed: ${err.message}. Trying next fallback...`);
    }
  }

  // Option C: Generate animated motion preview with FFmpeg
  // This creates a dynamic video with subtle motion effects instead of a static loop
  console.log('[VideoService] Cloud GPU queues offline/busy. Generating dynamic motion preview with animation effects...');
  
  try {
    const audioDuration = await getAudioDuration(audioPath);
    return await generateMotionPreview(imagePath, audioPath, outputPath, audioDuration);
  } catch (err) {
    // Absolute last resort: simple image + audio overlay
    console.warn(`[VideoService] Motion preview failed: ${err.message}. Using static image fallback...`);
    return new Promise((resolve, reject) => {
      fs.ensureDirSync(path.dirname(outputPath));
      ffmpeg(imagePath)
        .loop()
        .input(audioPath)
        .outputOptions([
          '-c:v libx264',
          '-tune stillimage',
          '-c:a aac',
          '-b:a 192k',
          '-pix_fmt yuv420p',
          '-vf scale=768:768:force_original_aspect_ratio=decrease,pad=768:768:(ow-iw)/2:(oh-ih)/2',
          '-shortest',
          '-movflags +faststart'
        ])
        .output(outputPath)
        .on('end', () => resolve({ success: true, method: 'static_fallback', outputPath }))
        .on('error', (err) => reject(err))
        .run();
    });
  }
}
