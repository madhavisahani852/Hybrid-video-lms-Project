import fs from 'fs-extra';
import path from 'path';
import zlib from 'zlib';

/**
 * Avatar Generator Service
 * Multi-provider approach with automatic fallbacks:
 * 1. Pollinations.ai (Free, $0, no API key) - simple portrait generation
 * 2. Hugging Face FLUX.1-schnell Inference API (Free with HF_TOKEN)
 * 3. Procedural placeholder PNG (Guaranteed 100% uptime, no external deps)
 */

const DEFAULT_PROMPT = 'A professional realistic tech presenter portrait, 8k, photorealistic face, neutral background, studio lighting';

/**
 * Generate avatar image using Pollinations.ai (free, no API key)
 */
async function pollinationsGen(prompt, outputPath) {
  const encoded = encodeURIComponent(prompt);
  const seed = Math.floor(Math.random() * 1000000);
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=768&height=768&seed=${seed}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Pollinations returned ${res.status}`);
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      throw new Error(`Non-image response: ${contentType}`);
    }
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 100) {
      throw new Error('Response too small to be an image');
    }
    await fs.writeFile(outputPath, Buffer.from(buffer));
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Generate avatar image using Hugging Face FLUX.1-schnell Inference API
 */
async function hfFluxGen(prompt, outputPath, hfToken) {
  const token = hfToken || process.env.HF_TOKEN;
  if (!token) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(
      'https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            width: 768,
            height: 768,
            num_inference_steps: 4
          }
        }),
        signal: controller.signal
      }
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[AvatarService] HF FLUX returned ${res.status}: ${errText.slice(0, 200)}`);
      return false;
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const json = await res.json();
      if (json?.image) {
        const base64 = json.image.replace(/^data:image\/\w+;base64,/, '');
        await fs.writeFile(outputPath, Buffer.from(base64, 'base64'));
        return true;
      }
      return false;
    }

    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 100) {
      return false;
    }
    await fs.writeFile(outputPath, Buffer.from(buffer));
    return true;
  } catch (err) {
    console.warn(`[AvatarService] HF FLUX error: ${err.message}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// Pre-computed CRC32 table for PNG chunk integrity (built once)
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c;
}

function pngCrc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Create a PNG chunk (length + type + data + crc)
 */
function pngChunk(type, data) {
  const typeB = Buffer.from(type, 'ascii');
  const lenB = Buffer.alloc(4);
  lenB.writeUInt32BE(data.length);
  const crcData = Buffer.concat([typeB, data]);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(pngCrc32(crcData));
  return Buffer.concat([lenB, typeB, data, crcB]);
}

/**
 * Generate a high-quality procedural portrait PNG (guaranteed 100% uptime)
 * Uses no external deps - pure Node.js zlib + manual PNG construction
 * Generates a realistic-looking presenter with proper face proportions
 */
async function placeholderGen(outputPath) {
  const W = 768, H = 768;

  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR: 768x768, 8-bit RGB
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Build raw pixel rows (filter byte + RGB data per row)
  const rowSize = 1 + W * 3;
  const raw = Buffer.alloc(rowSize * H);

  // Face center and proportions for a natural-looking portrait
  const faceCenterX = W / 2;
  const faceCenterY = H * 0.38;  // face slightly above center
  const faceWidth = W * 0.34;     // width of face
  const faceHeight = H * 0.40;    // height of face

  // Helper: check if point is inside an ellipse
  const inEllipse = (x, y, cx, cy, rx, ry) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return dx * dx + dy * dy <= 1.0;
  };

  // Smooth noise function for skin texture
  const smoothNoise = (x, y) => {
    const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  };

  for (let y = 0; y < H; y++) {
    const rowStart = y * rowSize;
    raw[rowStart] = 0; // filter: None

    for (let x = 0; x < W; x++) {
      const px = rowStart + 1 + x * 3;
      const noise = smoothNoise(x * 0.01, y * 0.01) * 0.03; // subtle skin noise

      // Background: professional dark gradient with vignette effect
      const vignette = 0.7 + 0.3 * (1 - Math.sqrt(Math.pow(x/W - 0.5, 2) * 2 + Math.pow(y/H - 0.5, 2) * 2));
      const bgR = Math.floor((25 + (y / H) * 15) * vignette);
      const bgG = Math.floor((30 + (y / H) * 10) * vignette);
      const bgB = Math.floor((50 + (y / H) * 15) * vignette);

      // Face shape (more natural human face proportions)
      const faceRx = faceWidth * 0.5;
      const faceRy = faceHeight * 0.5;
      const inFace = inEllipse(x, y, faceCenterX, faceCenterY, faceRx, faceRy);

      // Jaw line (slightly narrower at bottom)
      const jawOffset = Math.pow((y - faceCenterY) / (faceRy), 2) * faceRx * 0.12;
      const jawAdjustedRx = faceRx - jawOffset;
      const inJawFace = inEllipse(x, y, faceCenterX, faceCenterY, jawAdjustedRx, faceRy);

      // Shoulders region
      const shoulderY = faceCenterY + faceRy * 0.6;
      const shoulderRx = W * 0.32;
      const shoulderRy = H * 0.22;
      const inShoulders = inEllipse(x, y, faceCenterX, shoulderY, shoulderRx, shoulderRy) && y > faceCenterY + faceRy * 0.2;

      // Neck region
      const inNeck = x > faceCenterX - faceRx * 0.2 && x < faceCenterX + faceRx * 0.2 
        && y > faceCenterY + faceRy * 0.7 && y < faceCenterY + faceRy * 1.1;

      if (inFace) {
        // Skin tone gradient with subtle noise for realism
        const dy = (y - faceCenterY) / faceRy;
        const skinR = Math.floor((230 + noise * 50 - dy * 20));
        const skinG = Math.floor((190 + noise * 40 - dy * 15));
        const skinB = Math.floor((155 + noise * 30 - dy * 10));
        raw[px] = Math.min(255, Math.max(0, skinR));
        raw[px + 1] = Math.min(255, Math.max(0, skinG));
        raw[px + 2] = Math.min(255, Math.max(0, skinB));

        // Hairstyle (professional cut)
        const isHairRegion = y < faceCenterY - faceRy * 0.3;
        const hairWidth = faceRx * 1.05;
        const hairHeight = faceRy * 0.5;
        const inHairTop = inEllipse(x, y, faceCenterX, faceCenterY - faceRy * 0.55, hairWidth, hairHeight);
        
        if (inHairTop && y < faceCenterY + faceRy * 0.1) {
          // Dark hair with subtle highlights
          const hairShade = Math.floor(35 + 15 * (1 - (y - (faceCenterY - faceRy * 0.7)) / (faceRy * 0.7)));
          raw[px] = Math.min(255, hairShade + Math.floor(noise * 20));
          raw[px + 1] = Math.min(255, hairShade - 5 + Math.floor(noise * 15));
          raw[px + 2] = Math.min(255, hairShade + 10 + Math.floor(noise * 15));
        }

        // Eyebrows
        const browY = faceCenterY - faceRy * 0.18;
        for (const browX of [faceCenterX - faceRx * 0.22, faceCenterX + faceRx * 0.22]) {
          if (inEllipse(x, y, browX, browY, faceRx * 0.1, faceRy * 0.025)) {
            raw[px] = Math.max(0, raw[px] - 80);
            raw[px + 1] = Math.max(0, raw[px + 1] - 70);
            raw[px + 2] = Math.max(0, raw[px + 2] - 60);
          }
        }

        // Eyes with detail (iris, pupil, white)
        const eyeY = faceCenterY - faceRy * 0.05;
        for (const eyeX of [faceCenterX - faceRx * 0.22, faceCenterX + faceRx * 0.22]) {
          // Eye white
          if (inEllipse(x, y, eyeX, eyeY, faceRx * 0.08, faceRy * 0.06)) {
            raw[px] = 255; raw[px + 1] = 255; raw[px + 2] = 255;
          }
          // Iris (colored ring)
          if (inEllipse(x, y, eyeX, eyeY, faceRx * 0.045, faceRy * 0.04)) {
            raw[px] = 80; raw[px + 1] = 120; raw[px + 2] = 160; // Blue iris
          }
          // Pupil
          if (inEllipse(x, y, eyeX, eyeY, faceRx * 0.025, faceRy * 0.025)) {
            raw[px] = 20; raw[px + 1] = 20; raw[px + 2] = 30;
          }
          // Eye highlight (catchlight)
          if (inEllipse(x, y, eyeX + faceRx * 0.015, eyeY - faceRy * 0.015, faceRx * 0.012, faceRy * 0.012)) {
            raw[px] = 255; raw[px + 1] = 255; raw[px + 2] = 255;
          }
        }

        // Nose
        const noseTipX = faceCenterX;
        const noseTipY = faceCenterY + faceRy * 0.08;
        if (inEllipse(x, y, noseTipX, noseTipY, faceRx * 0.04, faceRy * 0.04)) {
          raw[px] = Math.min(255, raw[px] - 15);
          raw[px + 1] = Math.min(255, raw[px + 1] - 10);
          raw[px + 2] = Math.min(255, raw[px + 2] - 5);
        }
        // Nose bridge
        if (x > faceCenterX - faceRx * 0.025 && x < faceCenterX + faceRx * 0.025
          && y > faceCenterY - faceRy * 0.1 && y < faceCenterY + faceRy * 0.08) {
          raw[px] = Math.min(255, raw[px] + 10);
          raw[px + 1] = Math.min(255, raw[px + 1] + 8);
          raw[px + 2] = Math.min(255, raw[px + 2] + 5);
        }

        // Mouth with lips detail
        const mouthY = faceCenterY + faceRy * 0.20;
        // Upper lip
        if (inEllipse(x, y, faceCenterX, mouthY - faceRy * 0.01, faceRx * 0.12, faceRy * 0.025)) {
          raw[px] = 170; raw[px + 1] = 85; raw[px + 2] = 75;
        }
        // Lower lip
        if (inEllipse(x, y, faceCenterX, mouthY + faceRy * 0.02, faceRx * 0.11, faceRy * 0.025)) {
          raw[px] = 185; raw[px + 1] = 95; raw[px + 2] = 85;
        }
        // Mouth line
        if (Math.abs(y - mouthY) < 2 && Math.abs(x - faceCenterX) < faceRx * 0.1) {
          raw[px] = 130; raw[px + 1] = 60; raw[px + 2] = 55;
        }

        // Cheek blush (subtle)
        for (const cheekX of [faceCenterX - faceRx * 0.3, faceCenterX + faceRx * 0.3]) {
          if (inEllipse(x, y, cheekX, faceCenterY + faceRy * 0.08, faceRx * 0.1, faceRy * 0.06)) {
            raw[px] = Math.min(255, raw[px] + 10);
            raw[px + 1] = Math.max(0, raw[px + 1] - 5);
            raw[px + 2] = Math.max(0, raw[px + 2] - 5);
          }
        }

      } else if (inShoulders || inNeck) {
        // Professional attire (dark suit/blazer)
        const clothR = inNeck ? 210 : 45;
        const clothG = inNeck ? 170 : 50;
        const clothB = inNeck ? 140 : 65;
        // Collar detail
        const isCollar = inShoulders && inNeck && Math.abs(x - faceCenterX) > faceRx * 0.12;
        if (isCollar) {
          raw[px] = 55; raw[px + 1] = 60; raw[px + 2] = 75; // darker collar
        } else {
          raw[px] = clothR; raw[px + 1] = clothG; raw[px + 2] = clothB;
        }
      } else {
        // Background gradient
        raw[px] = Math.min(255, Math.max(0, bgR));
        raw[px + 1] = Math.min(255, Math.max(0, bgG));
        raw[px + 2] = Math.min(255, Math.max(0, bgB));
      }
    }
  }

  // Compress raw pixel data with zlib
  const compressed = zlib.deflateSync(raw, { level: 6 });

  // Assemble PNG
  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);

  await fs.writeFile(outputPath, png);
  return true;
}

/**
 * Main avatar generation function with automatic fallback chain
 */
export async function generateAvatarImage(prompt, outputPath) {
  const finalPrompt = (prompt || DEFAULT_PROMPT).trim();
  await fs.ensureDir(path.dirname(outputPath));

  // Strategy 1: Pollinations.ai (fast, free)
  try {
    console.log('[AvatarService] Trying Pollinations.ai...');
    await pollinationsGen(finalPrompt, outputPath);
    console.log('[AvatarService] ✅ Pollinations.ai success');
    return { success: true, outputPath, method: 'pollinations' };
  } catch (err) {
    console.warn(`[AvatarService] Pollinations failed: ${err.message}`);
  }

  // Strategy 2: Hugging Face FLUX (requires HF_TOKEN)
  try {
    console.log('[AvatarService] Trying Hugging Face FLUX...');
    const hfOk = await hfFluxGen(finalPrompt, outputPath);
    if (hfOk) {
      console.log('[AvatarService] ✅ Hugging Face FLUX success');
      return { success: true, outputPath, method: 'huggingface-flux' };
    }
  } catch (err) {
    console.warn(`[AvatarService] HF FLUX failed: ${err.message}`);
  }

  // Strategy 3: Procedural placeholder PNG (guaranteed)
  console.log('[AvatarService] Generating procedural placeholder avatar...');
  await placeholderGen(outputPath);
  console.log('[AvatarService] ✅ Placeholder avatar generated');
  return { success: true, outputPath, method: 'placeholder' };
}
