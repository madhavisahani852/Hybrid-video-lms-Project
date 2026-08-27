import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateRenderedVideo } from './scripts/validate_video.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRAMES_DIR = path.join(__dirname, 'public/assets/frames');
const ASSETS_DIR = path.join(__dirname, 'public/assets');
const OUTPUT_MP4 = path.join(__dirname, 'output.mp4');

async function render() {
  console.log("Cleaning old frames directory...");
  if (fs.existsSync(FRAMES_DIR)) {
    fs.rmSync(FRAMES_DIR, { recursive: true });
  }
  fs.mkdirSync(FRAMES_DIR, { recursive: true });

  // 1. Start the express dev server gracefully
  console.log("Ensuring web server is running on port 3000...");
  const server = spawn('node', ['src/index.js'], { cwd: __dirname });
  server.on('error', (err) => {
    console.log("Notice: Node process spawn error (possibly port 3000 in use):", err.message);
  });
  
  // Wait 3 seconds for server binding
  await new Promise(resolve => setTimeout(resolve, 3000));

  let page;
  try {
    // Import Playwright
    const { chromium } = await import('playwright');
    
    console.log("Launching sandboxed Playwright Chromium (1920x1080 Full HD)...");
    const browser = await chromium.launch({
      headless: true
    });
    
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1
    });
    
    page = await context.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    console.log("Loading animation preview player...");
    await page.goto('http://localhost:3000/index.html', { waitUntil: 'load' });
    
    // Pause auto-playback loop
    await page.evaluate(() => {
      if (typeof window.pause === 'function') {
        window.pause();
      }
    });

    // Wait for client-side JS initialization
    await page.waitForFunction(() => typeof window.stepDurations !== 'undefined' && window.stepDurations.length > 0, { timeout: 10000 });

    // Query step durations
    const { stepDurations, totalDuration } = await page.evaluate(() => {
      return {
        stepDurations: window.stepDurations || [],
        totalDuration: window.totalDuration || 0
      };
    });
    
    console.log(`Video total duration: ${totalDuration.toFixed(2)} seconds.`);
    
    const fps = 30; // Production standard 30 FPS
    const totalFrames = Math.ceil(totalDuration * fps);
    console.log(`Rendering ${totalFrames} frames at ${fps} FPS...`);
    
    for (let f = 0; f < totalFrames; f++) {
      const time = f / fps;
      
      // Force render frame at exact playhead time
      await page.evaluate((t) => {
        window.currentTime = t;
        if (typeof window.renderFrame === 'function') {
          window.renderFrame(t);
        }
      }, time);
      
      // Capture screenshot of the #video-canvas element
      const element = page.locator('#video-canvas');
      const filename = `frame_${String(f).padStart(5, '0')}.png`;
      const filePath = path.join(FRAMES_DIR, filename);
      
      await element.screenshot({ path: filePath });
      
      if (f % 100 === 0 || f === totalFrames - 1) {
        console.log(`Rendered frame ${f}/${totalFrames} (${Math.round((f / totalFrames) * 100)}%)`);
      }
    }
    
    console.log("Headless rendering complete. Closing browser...");
    await browser.close();

    // 2. Concatenate existing audio voiceover files
    console.log("Preparing audio track concatenation...");
    const concatListPath = path.join(__dirname, 'concat_list.txt');
    let concatListContent = "";
    let stepCount = 0;
    for (let i = 0; i < 100; i++) {
      const stepAudio = path.join(__dirname, `public/assets/audio/step_${i}.wav`);
      if (fs.existsSync(stepAudio)) {
        concatListContent += `file '${stepAudio}'\n`;
        stepCount++;
      }
    }

    const finalAudioWav = path.join(ASSETS_DIR, 'final_audio.wav');
    if (stepCount > 0) {
      fs.writeFileSync(concatListPath, concatListContent);
      console.log(`Compiling ${stepCount} audio tracks with ffmpeg (48kHz stereo)...`);
      execSync(`ffmpeg -f concat -safe 0 -i "${concatListPath}" -c:a pcm_s16le -ar 48000 -ac 2 -y "${finalAudioWav}"`, { stdio: 'inherit' });
      if (fs.existsSync(concatListPath)) fs.unlinkSync(concatListPath);
    }

    // 3. Compile screenshots to video with production-grade encoding
    console.log("Compiling 30 FPS video frames with ffmpeg (CRF 18, Lanczos, BT.709)...");
    const finalVideoMp4 = path.join(ASSETS_DIR, 'final_video.mp4');
    execSync(`ffmpeg -framerate 30 -i "${FRAMES_DIR}/frame_%05d.png" -vf "scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libx264 -preset medium -crf 18 -g 60 -keyint_min 30 -sc_threshold 0 -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -y "${finalVideoMp4}"`, { stdio: 'inherit' });

    // 4. Multiplex audio and video
    console.log("Multiplexing audio and video into final output.mp4...");
    if (fs.existsSync(finalAudioWav)) {
      execSync(`ffmpeg -i "${finalVideoMp4}" -i "${finalAudioWav}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ar 48000 -ac 2 -movflags +faststart -shortest -y "${OUTPUT_MP4}"`, { stdio: 'inherit' });
    } else {
      execSync(`ffmpeg -i "${finalVideoMp4}" -c:v copy -movflags +faststart -y "${OUTPUT_MP4}"`, { stdio: 'inherit' });
    }

    // Cleanup temp files
    console.log("Cleaning up temporary render files...");
    if (fs.existsSync(finalAudioWav)) fs.unlinkSync(finalAudioWav);
    if (fs.existsSync(finalVideoMp4)) fs.unlinkSync(finalVideoMp4);
    if (fs.existsSync(FRAMES_DIR)) fs.rmSync(FRAMES_DIR, { recursive: true });

    // 5. Automatic quality validation
    validateRenderedVideo(OUTPUT_MP4, { expectedFps: 30, expectedWidth: 1920, expectedHeight: 1080 });

    console.log(`SUCCESS! Final production video saved to: ${OUTPUT_MP4}`);
  } catch (err) {
    console.error("Renderer Pipeline Failed:", err);
    try {
      if (typeof page !== 'undefined') {
        await page.screenshot({ path: path.join(__dirname, 'public/error_page.png'), fullPage: true });
        console.log("Saved error page screenshot to public/error_page.png");
      }
    } catch (ssErr) {
      console.error("Failed to capture error page screenshot:", ssErr);
    }
  } finally {
    console.log("Cleaning up server processes...");
    server.kill();
  }
}

render();

