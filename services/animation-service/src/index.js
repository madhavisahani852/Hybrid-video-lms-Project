import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { execSync, exec } from 'child_process';
import util from 'util';
const execPromise = util.promisify(exec);
import { subtitlesList } from './subtitles.js';
import { explainerSubtitlesList } from './explainer_subtitles.js';
import { ragSubtitlesList } from './rag_subtitles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve testing sandbox as the default homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/test.html'));
});

app.use(express.static(path.join(__dirname, '../public')));

// In-memory render job database
const jobsDb = new Map();

const API_KEY = process.env.SARVAM_API_KEY;
if (!API_KEY) {
  throw new Error(
    'SARVAM_API_KEY environment variable is not configured. ' +
    'Set it in your .env file or in the process environment before starting the service.'
  );
}

const celebrityVoiceMap = {
  // Male
  'shahrukh': { speaker: 'aditya', language_code: 'en-IN' },
  'shahrukhkhan': { speaker: 'aditya', language_code: 'en-IN' },
  'sharukh': { speaker: 'aditya', language_code: 'en-IN' },
  'srk': { speaker: 'aditya', language_code: 'en-IN' },
  'ntr': { speaker: 'shubh', language_code: 'en-IN' },
  'ntrjr': { speaker: 'shubh', language_code: 'en-IN' },
  'jrntr': { speaker: 'shubh', language_code: 'en-IN' },
  // Female
  'deepika': { speaker: 'shreya', language_code: 'en-IN' },
  'deepikapadukone': { speaker: 'shreya', language_code: 'en-IN' },
  'priyanka': { speaker: 'shreya', language_code: 'en-IN' },
  'priyankachopra': { speaker: 'shreya', language_code: 'en-IN' },
  'katrina': { speaker: 'shreya', language_code: 'en-IN' },
  'katrinakaif': { speaker: 'shreya', language_code: 'en-IN' },
  'alia': { speaker: 'shreya', language_code: 'en-IN' },
  'aliabhatt': { speaker: 'shreya', language_code: 'en-IN' },
  'rashmika': { speaker: 'shreya', language_code: 'en-IN' },
  'rashmikamandanna': { speaker: 'shreya', language_code: 'en-IN' },
  'nayanthara': { speaker: 'shreya', language_code: 'en-IN' },
  'madhuri': { speaker: 'shreya', language_code: 'en-IN' },
  'madhuridixit': { speaker: 'shreya', language_code: 'en-IN' },
  'kareena': { speaker: 'shreya', language_code: 'en-IN' },
  'kareenakapoor': { speaker: 'shreya', language_code: 'en-IN' },
  'shraddha': { speaker: 'shreya', language_code: 'en-IN' },
  'shraddhakapoor': { speaker: 'shreya', language_code: 'en-IN' },
  'aruna': { speaker: 'shreya', language_code: 'en-IN' }
};

function getCelebrityVoice(name, gender) {
  const defaultMale = { speaker: 'aditya', language_code: 'en-IN' };
  const defaultFemale = { speaker: 'shreya', language_code: 'en-IN' };
  
  if (!name) {
    return gender === 'female' ? defaultFemale : defaultMale;
  }
  
  const normalized = name.toLowerCase().trim().replace(/[^a-z]/g, '');
  if (celebrityVoiceMap[normalized]) {
    return celebrityVoiceMap[normalized];
  }
  for (const key of Object.keys(celebrityVoiceMap)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return celebrityVoiceMap[key];
    }
  }
  
  if (gender === 'female') {
    return defaultFemale;
  }
  
  const femaleCelebrities = ['deepika', 'priyanka', 'katrina', 'alia', 'madhuri', 'kareena', 'shraddha', 'rashmika', 'nayanthara', 'female', 'aruna'];
  const isFemale = femaleCelebrities.some(item => normalized.includes(item));
  if (isFemale) {
    return defaultFemale;
  }
  
  return defaultMale;
}

// Helper: fetch with retry and rate limit (429) backoff
async function fetchWithRetry(url, options, retries = 5, delay = 1500) {
  let currentDelay = delay;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      
      if (response.status === 402) {
        throw new Error('Sarvam AI API key is out of credits (402 Payment Required). Please provide a funded API key.');
      }
      
      const statusText = response.statusText || '';
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : currentDelay;
        console.warn(`429 Too Many Requests. Waiting for ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        currentDelay = Math.min(currentDelay * 2, 10000); // backoff
        continue;
      }
      
      console.warn(`Attempt ${i + 1} failed with status ${response.status} ${statusText}. Retrying...`);
    } catch (err) {
      if (err.message.includes('402 Payment Required') || i === retries - 1) throw err;
      console.warn(`Attempt ${i + 1} failed with error: ${err.message}. Retrying...`);
    }
    await new Promise(resolve => setTimeout(resolve, currentDelay));
    currentDelay = Math.min(currentDelay * 2, 10000); // backoff
  }
  throw new Error(`Failed after ${retries} retries`);
}

// Helper: limit concurrency using a worker pool
async function limitConcurrency(tasks, limit) {
  const results = [];
  let index = 0;
  const runWorker = async () => {
    while (index < tasks.length) {
      const currentIndex = index++;
      results[currentIndex] = await tasks[currentIndex]();
    }
  };
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

// Render pipeline background process
async function runRenderPipeline(jobId, speaker, languageCode) {
  const job = jobsDb.get(jobId);
  console.log(`\n\x1b[36m[Job Started]\x1b[0m Job ID: ${jobId} | Course: ${job.course} | Celebrity voice: ${job.celebrity} (${speaker})`);
  try {
    const courseSubtitles = job.course === 'git'
      ? subtitlesList
      : (job.course === 'explainer' ? explainerSubtitlesList : ragSubtitlesList);
    const courseUrl = job.course === 'git'
      ? `http://localhost:${activePort}/index.html?jobId=${jobId}`
      : `http://localhost:${activePort}/explainer/index.html?jobId=${jobId}`;

    const jobAudioDir = path.join(__dirname, `../public/assets/audio_${jobId}`);
    if (!fs.existsSync(jobAudioDir)) {
      fs.mkdirSync(jobAudioDir, { recursive: true });
    }

    // 1. Generate all TTS files
    job.status = 'generating_audio';
    job.progress = 10;
    jobsDb.set(jobId, { ...job });

    const tasks = courseSubtitles.map((subtitle, index) => async () => {
      const filename = `step_${index}.wav`;
      const outputPath = path.join(jobAudioDir, filename);

      const response = await fetchWithRetry("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "api-subscription-key": API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: subtitle,
          target_language_code: languageCode,
          speaker: speaker,
          model: "bulbul:v3"
        })
      });

      const data = await response.json();
      if (!data.audios || !data.audios[0]) {
        throw new Error(`No audio returned from Sarvam for step ${index}`);
      }

      const audioBuffer = Buffer.from(data.audios[0], 'base64');
      fs.writeFileSync(outputPath, audioBuffer);
    });

    await limitConcurrency(tasks, 2);

    // 2. Probing durations
    job.status = 'probing_durations';
    job.progress = 30;
    jobsDb.set(jobId, { ...job });

    const durations = [];
    for (let i = 0; i < courseSubtitles.length; i++) {
      const filePath = path.join(jobAudioDir, `step_${i}.wav`);
      const { stdout } = await execPromise(`ffprobe -i "${filePath}" -show_entries format=duration -v quiet -of csv="p=0"`);
      const duration = parseFloat(stdout.trim()) + 0.4;
      durations.push(duration);
    }

    job.durations = durations;
    jobsDb.set(jobId, { ...job });
    console.log(`\x1b[36m[Job Progress]\x1b[0m Job ID: ${jobId} | Step speech durations parsed. Starting Playwright frame screenshot rendering...`);

    // 3. Render silent video
    const finalVideoMp4 = path.join(__dirname, `../public/assets/final_video_${jobId}.mp4`);
    const FRAMES_DIR = path.join(__dirname, `../public/assets/frames_${jobId}`);

    if (job.course === 'rag') {
      job.status = 'rendering_frames';
      job.progress = 40;
      jobsDb.set(jobId, { ...job });
      console.log(`\x1b[36m[Job Progress]\x1b[0m Job ID: ${jobId} | Running native Revideo compiler for RAG course (this may take a few minutes)...`);

      const ragTemplateDir = path.join(__dirname, '../templates/rag');

      // Stream the render process so we can forward Revideo's own progress (40→80%)
      await new Promise((resolve, reject) => {
        const child = exec(`npm run render`, {
          cwd: ragTemplateDir,
          maxBuffer: 100 * 1024 * 1024,
          env: { ...process.env, PUPPETEER_DISABLE_SANDBOX: 'true' }
        });

        const handleData = (data) => {
          const text = data.toString();
          process.stdout.write(text);
          // Revideo logs "Render progress, worker 0: X%"
          const m = text.match(/Render progress.*?:\s*([\d.]+)%/i);
          if (m) {
            const revideoPct = parseFloat(m[1]);
            // Map Revideo 0-100% → job 40-80%
            const jobPct = 40 + Math.round(revideoPct * 0.4);
            job.progress = jobPct;
            jobsDb.set(jobId, { ...job });
          }
        };

        if (child.stdout) child.stdout.on('data', handleData);
        if (child.stderr) child.stderr.on('data', handleData);

        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`npm run render exited with code ${code}`));
        });
        child.on('error', reject);
      });

      const defaultOutput = path.join(ragTemplateDir, 'output/video.mp4');
      if (!fs.existsSync(defaultOutput)) {
        throw new Error('Native Revideo renderer finished but output file was not found.');
      }
      fs.copyFileSync(defaultOutput, finalVideoMp4);
    } else {
      // Run Playwright headless browser to render frames for git/explainer
      job.status = 'rendering_frames';
      job.progress = 40;
      jobsDb.set(jobId, { ...job });

      if (fs.existsSync(FRAMES_DIR)) {
        fs.rmSync(FRAMES_DIR, { recursive: true });
      }
      fs.mkdirSync(FRAMES_DIR, { recursive: true });

      const { chromium } = await import('playwright');
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 }
      });

      const page = await context.newPage();
      await page.goto(courseUrl, { waitUntil: 'load' });

      // Pause auto-playback loop
      await page.evaluate(() => {
        if (typeof window.pause === 'function') {
          window.pause();
        }
      });

      // Wait for stepDurations initialization
      await page.waitForFunction(() => typeof window.stepDurations !== 'undefined' && window.stepDurations.length > 0, { timeout: 10000 });

      const totalDuration = durations.reduce((a, b) => a + b, 0);
      const fps = 15;
      const totalFrames = Math.ceil(totalDuration * fps);

      for (let f = 0; f < totalFrames; f++) {
        const time = f / fps;

        await page.evaluate((t) => {
          window.currentTime = t;
          window.renderFrame(t);
        }, time);

        const element = page.locator('#video-canvas');
        const filename = `frame_${String(f).padStart(5, '0')}.png`;
        const filePath = path.join(FRAMES_DIR, filename);

        await element.screenshot({ path: filePath });

        if (f % 100 === 0 || f === totalFrames - 1) {
          const frameProgress = 40 + Math.round((f / totalFrames) * 40);
          console.log(`\x1b[36m[Job Progress]\x1b[0m Job ID: ${jobId} | Rendering frames: ${f}/${totalFrames} (${frameProgress}%)`);
          job.status = 'rendering_frames';
          job.progress = frameProgress;
          jobsDb.set(jobId, { ...job });
        }
      }

      await browser.close();

      // Compile screenshots to video
      job.status = 'compiling_video';
      job.progress = 90;
      jobsDb.set(jobId, { ...job });
      console.log(`\x1b[36m[Job Progress]\x1b[0m Job ID: ${jobId} | All frames rendered. Compiling frames to video...`);

      await execPromise(`ffmpeg -framerate 15 -i "${FRAMES_DIR}/frame_%05d.png" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -pix_fmt yuv420p -y "${finalVideoMp4}"`);
    }

    // 4. Concatenate audio
    job.status = 'compiling_audio';
    job.progress = 85;
    jobsDb.set(jobId, { ...job });
    console.log(`\x1b[36m[Job Progress]\x1b[0m Job ID: ${jobId} | Compiling custom voice narration track...`);

    const concatListPath = path.join(__dirname, `../concat_list_${jobId}.txt`);
    let concatListContent = "";
    for (let i = 0; i < courseSubtitles.length; i++) {
      const stepAudio = path.join(jobAudioDir, `step_${i}.wav`);
      concatListContent += `file '${stepAudio}'\n`;
    }
    fs.writeFileSync(concatListPath, concatListContent);

    const finalAudioWav = path.join(__dirname, `../public/assets/final_audio_${jobId}.wav`);
    await execPromise(`ffmpeg -f concat -safe 0 -i "${concatListPath}" -y "${finalAudioWav}"`);
    fs.unlinkSync(concatListPath);

    // 5. Multiplex audio and video
    job.status = 'multiplexing';
    job.progress = 95;
    jobsDb.set(jobId, { ...job });
    console.log(`\x1b[36m[Job Progress]\x1b[0m Job ID: ${jobId} | Multiplexing video and audio tracks...`);

    const OUTPUT_DIR = path.join(__dirname, '../public/outputs');
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const finalOutputMp4 = path.join(OUTPUT_DIR, `video_${jobId}.mp4`);
    await execPromise(`ffmpeg -i "${finalVideoMp4}" -i "${finalAudioWav}" -c:v copy -c:a aac -shortest -y "${finalOutputMp4}"`);

    // 6. Cleanup temp files
    if (fs.existsSync(finalAudioWav)) fs.unlinkSync(finalAudioWav);
    if (fs.existsSync(finalVideoMp4)) fs.unlinkSync(finalVideoMp4);
    if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });

    job.status = 'completed';
    job.progress = 100;
    job.completed_at = new Date().toISOString();
    job.output_url = `/outputs/video_${jobId}.mp4`;
    jobsDb.set(jobId, { ...job });

    // Populate pre-rendered cache if it doesn't exist yet
    const cachePath = path.join(OUTPUT_DIR, `video_${job.course}_${job.gender}.mp4`);
    if (!fs.existsSync(cachePath)) {
      console.log(`\x1b[32m[Cache Write]\x1b[0m Job ID: ${jobId} | Populating cache for ${job.course} (${job.gender})`);
      try {
        fs.copyFileSync(finalOutputMp4, cachePath);
      } catch (cacheErr) {
        console.error(`Failed to write cache file: ${cacheErr.message}`);
      }
    }

    console.log(`\x1b[32m[Job Completed]\x1b[0m Job ID: ${jobId} | Video generated successfully at: public/outputs/video_${jobId}.mp4\n`);
  } catch (err) {
    console.error(`\x1b[31m[Job Failed]\x1b[0m Job ID: ${jobId} | Error:`, err);
    job.status = 'failed';
    job.error = err.message;
    jobsDb.set(jobId, { ...job });
  }
}

app.get('/health', (req, res) => {
  res.json({ name: 'Animation Service', status: 'healthy' });
});

// Dynamic configuration endpoint for page rendering
app.get('/api/job/:jobId/config.js', (req, res) => {
  const { jobId } = req.params;
  const job = jobsDb.get(jobId);
  if (!job || !job.durations) {
    return res.status(404).send('// Job not found or configuration not ready');
  }
  res.type('application/javascript');
  res.send(`
    window.overrideStepDurations = ${JSON.stringify(job.durations)};
    window.overrideAudioDir = 'assets/audio_${jobId}';
  `);
});

// Create video generation job
app.post('/api/v1/course/generate', (req, res) => {
  const { celebrity, course, gender } = req.body;
  if (!celebrity) {
    return res.status(400).json({ error: 'Missing celebrity name in request body.' });
  }

  const selectedCourse = course || 'git';
  const supportedCourses = ['git', 'rag', 'explainer'];
  if (!supportedCourses.includes(selectedCourse.toLowerCase())) {
    return res.status(400).json({ error: `Unsupported course: ${selectedCourse}. Supported courses are: git, rag, explainer.` });
  }

  // Determine gender dynamically or via body override
  let targetGender = gender;
  if (!targetGender || (targetGender !== 'male' && targetGender !== 'female')) {
    const normalizedCeleb = celebrity.toLowerCase();
    const femaleCelebrities = ['deepika', 'priyanka', 'katrina', 'alia', 'madhuri', 'kareena', 'shraddha', 'rashmika', 'nayanthara', 'female', 'aruna'];
    const isFemale = femaleCelebrities.some(name => normalizedCeleb.includes(name));
    targetGender = isFemale ? 'female' : 'male';
  }

  const voice = getCelebrityVoice(celebrity, targetGender);
  const jobId = `job_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
  const courseKey = selectedCourse.toLowerCase();

  const job = {
    job_id: jobId,
    celebrity,
    course: courseKey,
    gender: targetGender,
    speaker: voice.speaker,
    language_code: voice.language_code,
    status: 'queued',
    progress: 0,
    created_at: new Date().toISOString(),
    completed_at: null,
    output_url: null
  };

  jobsDb.set(jobId, job);
  console.log(`\x1b[35m[Job Queued]\x1b[0m Job ID: ${jobId} | Course: ${job.course} | Celebrity: ${celebrity} | Gender: ${targetGender}`);

  // Check if we have a pre-rendered cache video for this course & gender
  const cachePath = path.join(__dirname, `../public/outputs/video_${courseKey}_${targetGender}.mp4`);
  const finalOutputMp4 = path.join(__dirname, `../public/outputs/video_${jobId}.mp4`);

  if (fs.existsSync(cachePath)) {
    console.log(`\x1b[32m[Cache Hit]\x1b[0m Job ID: ${jobId} | Copying pre-rendered video for ${courseKey} (${targetGender}) instantly.`);
    
    // Ensure outputs directory exists
    const OUTPUT_DIR = path.dirname(finalOutputMp4);
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    fs.copyFileSync(cachePath, finalOutputMp4);

    job.status = 'completed';
    job.progress = 100;
    job.completed_at = new Date().toISOString();
    job.output_url = `/outputs/video_${jobId}.mp4`;
    jobsDb.set(jobId, { ...job });
    console.log(`\x1b[32m[Job Completed]\x1b[0m Job ID: ${jobId} | Course: ${job.course} | Loaded from cache instantly\n`);

    return res.status(200).json({
      job_id: jobId,
      status: 'completed',
      course: job.course,
      gender: job.gender,
      created_at: job.created_at,
      completed_at: job.completed_at,
      output_url: job.output_url,
      check_status_url: `/api/v1/course/jobs/${jobId}`,
      message: `Pre-rendered video for '${job.course}' (${targetGender}) loaded instantly.`
    });
  }

  // Fallback to background rendering if cache file is missing
  console.log(`\x1b[33m[Cache Miss]\x1b[0m Job ID: ${jobId} | Cache file not found. Starting render pipeline...`);
  runRenderPipeline(jobId, voice.speaker, voice.language_code);

  return res.status(202).json({
    job_id: jobId,
    status: 'queued',
    course: job.course,
    created_at: job.created_at,
    check_status_url: `/api/v1/course/jobs/${jobId}`,
    message: `Celebrity course video rendering job for '${job.course}' successfully queued.`
  });
});

// Get job status
app.get('/api/v1/course/jobs/:jobId', (req, res) => {
  const { jobId } = req.params;
  if (!jobsDb.has(jobId)) {
    return res.status(404).json({ error: 'Job not found' });
  }
  return res.status(200).json(jobsDb.get(jobId));
});

// Direct file download/stream endpoint
app.get('/api/v1/course/download/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobsDb.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  if (job.status !== 'completed') {
    return res.status(400).json({ error: `Job is in status: ${job.status}. Cannot download yet.` });
  }
  const filePath = path.join(__dirname, `../public/outputs/video_${jobId}.mp4`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Video file not found on disk' });
  }
  return res.sendFile(filePath);
});

// Legacy /render route
app.post('/render', (req, res) => {
  const { timeline, resolution, fps } = req.body;
  
  if (!timeline || !Array.isArray(timeline)) {
    return res.status(400).json({ error: 'Missing or invalid timeline list.' });
  }

  const renderId = `render_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
  
  const renderJob = {
    render_id: renderId,
    status: 'completed',
    output_file: `/outputs/${renderId}.mp4`,
    render_duration_seconds: 4.15,
    resolution: resolution || { width: 1920, height: 1080 },
    fps: fps || 30
  };

  rendersDb.set(renderId, renderJob);
  
  return res.status(200).json(renderJob);
});

let activePort = port;
const serverInstance = app.listen(port, () => {
  activePort = serverInstance.address().port;
  console.log(`Animation Service running on port ${activePort}`);
});
