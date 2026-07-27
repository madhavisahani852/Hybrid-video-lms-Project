import { execFile, execFileSync } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs-extra';

const execFileAsync = util.promisify(execFile);

export const VOICES = {
  'en-US-ChristopherNeural': 'Male (US - Christopher)',
  'en-US-JennyNeural': 'Female (US - Jenny)',
  'en-US-GuyNeural': 'Male (US - Guy)',
  'en-GB-SoniaNeural': 'Female (UK - Sonia)',
  'en-GB-RyanNeural': 'Male (UK - Ryan)',
  'en-IN-PrabhatNeural': 'Male (India - Prabhat)',
  'en-IN-NeerjaNeural': 'Female (India - Neerja)'
};

// Resolve edge-tts path once at module load time
function resolveEdgeTtsPath() {
  try {
    const result = execFileSync('which', ['edge-tts'], { encoding: 'utf8' });
    return result.trim();
  } catch {
    const fallbackPath = path.resolve('./venv/bin/edge-tts');
    if (fs.pathExistsSync(fallbackPath)) {
      return fallbackPath;
    }
  }
  return 'edge-tts'; // Let the system resolve it
}

const EDGE_TTS_PATH = resolveEdgeTtsPath();

/**
 * Text-To-Speech Service using Microsoft Edge TTS (Free, $0, no API key needed)
 * Uses locally installed edge-tts Python CLI tool for neural voice synthesis.
 */
export async function generateTTSAudio(text, outputPath, voice = 'en-US-ChristopherNeural') {
  const selectedVoice = VOICES[voice] ? voice : 'en-US-ChristopherNeural';

  try {
    await fs.ensureDir(path.dirname(outputPath));
    
    const { stdout, stderr } = await execFileAsync(EDGE_TTS_PATH, [
      '--text', text,
      '--write-media', outputPath,
      '--voice', selectedVoice
    ]);

    return {
      success: true,
      outputPath,
      voice: selectedVoice
    };
  } catch (err) {
    console.error('[TTSService] Edge-TTS Execution Error:', err);
    throw new Error(`Failed to generate TTS audio: ${err.message}`);
  }
}
