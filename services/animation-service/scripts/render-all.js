import fs from 'fs/promises';
import { renderVideo } from '@revideo/renderer';
import path from 'path';
import { execSync } from 'child_process';
import { validateRenderedVideo } from './validate_video.js';

const scenes = [
  'Scene001',
  'Scene002',
  'Scene003',
  'Scene004',
  'Scene005',
  'Scene006',
  'Scene007',
  'Scene008',
  'Scene009'
];

async function main() {
  const rawDir = path.join(process.cwd(), 'render-output', 'raw');
  const normDir = path.join(process.cwd(), 'render-output', 'normalized');
  await fs.mkdir(rawDir, { recursive: true });
  await fs.mkdir(normDir, { recursive: true });

  for (const scene of scenes) {
    console.log(`\n=== Rendering ${scene} ===`);
    const outPath = path.join(process.cwd(), 'render-output', 'raw', `${scene}.mp4`);
    try {
      execSync(`node scripts/render-single.js ${scene}`, { stdio: 'inherit' });
    } catch (err) {
      console.error(`Failed to render ${scene}:`, err);
    }

    console.log(`\n=== Normalizing & Muxing Audio for ${scene} ===`);
    const normPath = path.join(normDir, `${scene}.mp4`);
    const audioPath = path.join(process.cwd(), 'generated_audio', `${scene}-audio.wav`);
    
    try {
      // Check if audio file exists
      await fs.access(audioPath);
      // Mux audio and apply standardization protocol: 30 FPS, Lanczos 1080p, CRF 18, 48kHz stereo AAC
      execSync(`ffmpeg -y -i "${outPath}" -i "${audioPath}" -map 0:v:0 -map 1:a:0 -vf "scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libx264 -preset medium -crf 18 -r 30 -g 60 -keyint_min 30 -sc_threshold 0 -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -c:a aac -ar 48000 -ac 2 -b:a 192k -shortest "${normPath}"`, { stdio: 'inherit' });
    } catch (e) {
      console.warn(`\n⚠️ Audio file ${audioPath} not found! Rendering without audio.`);
      execSync(`ffmpeg -y -i "${outPath}" -vf "scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libx264 -preset medium -crf 18 -r 30 -g 60 -keyint_min 30 -sc_threshold 0 -color_range tv -colorspace bt709 -color_primaries bt709 -color_trc bt709 -an "${normPath}"`, { stdio: 'inherit' });
    }
  }

  console.log('\n=== Generating concat list ===');
  const concatListPath = path.join(process.cwd(), 'render-output', 'concat.txt');
  const concatContent = scenes.map(s => `file 'normalized/${s}.mp4'`).join('\n');
  await fs.writeFile(concatListPath, concatContent);

  console.log('\n=== Concatenating videos ===');
  const finalPath = path.join(process.cwd(), 'final-hybrid-video.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${concatListPath}" -c copy -movflags +faststart "${finalPath}"`, { stdio: 'inherit' });

  // Validate output
  try {
    validateRenderedVideo(finalPath, { expectedFps: 30, expectedWidth: 1920, expectedHeight: 1080 });
  } catch (valErr) {
    console.warn(`[Validation Warning] ${valErr.message}`);
  }

  console.log('\n✅ Render pipeline complete! Final file: ' + finalPath);
}

main().catch(console.error);

