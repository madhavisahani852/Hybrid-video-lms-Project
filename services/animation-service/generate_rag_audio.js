import "dotenv/config";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { ragSubtitlesList } from "./src/rag_subtitles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_KEY = process.env.SARVAM_API_KEY;

if (!API_KEY) {
  throw new Error(
    "SARVAM_API_KEY is not configured."
  );
}

const OUTPUT_DIR = path.join(
  __dirname,
  "public/assets/audio_rag"
);

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, {
    recursive: true
  });
}

async function generateAllTTS() {
  console.log(
    `Generating ${ragSubtitlesList.length} RAG audio files...`
  );

  for (
    let i = 0;
    i < ragSubtitlesList.length;
    i++
  ) {
    const text = ragSubtitlesList[i];

    const filename = `step_${i}.wav`;

    const outputPath = path.join(
      OUTPUT_DIR,
      filename
    );

    console.log(
      `\n[${i + 1}/${ragSubtitlesList.length}]`
    );

    console.log(text);

    try {
      const response = await fetch(
        "https://api.sarvam.ai/text-to-speech",
        {
          method: "POST",

          headers: {
            "api-subscription-key": API_KEY,
            "Content-Type": "application/json"
          },

          body: JSON.stringify({
            text,
            target_language_code: "en-IN",

            // Change this to your desired voice
            speaker: "aditya",

            model: "bulbul:v3"
          })
        }
      );

      if (!response.ok) {
        throw new Error(
          `Sarvam API error: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (
        !data.audios ||
        !data.audios[0]
      ) {
        throw new Error(
          "No audio returned by Sarvam API"
        );
      }

      const audioBuffer =
        Buffer.from(
          data.audios[0],
          "base64"
        );

      fs.writeFileSync(
        outputPath,
        audioBuffer
      );

      console.log(
        `Saved ${filename}`
      );

      // Small delay to reduce rate-limit problems
      await new Promise(resolve =>
        setTimeout(resolve, 300)
      );

    } catch (error) {
      console.error(
        `Failed to generate ${filename}:`,
        error.message
      );

      process.exit(1);
    }
  }

  console.log(
    "\nAll RAG audio files generated successfully."
  );
}

generateAllTTS();