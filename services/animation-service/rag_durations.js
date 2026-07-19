import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUDIO_DIR = path.join(
  __dirname,
  "public/assets/audio_rag"
);

const OUTPUT_FILE = path.join(
  __dirname,
  "src/rag_durations.ts"
);

if (!fs.existsSync(AUDIO_DIR)) {
  throw new Error(
    `Audio directory does not exist: ${AUDIO_DIR}`
  );
}

const audioFiles = fs
  .readdirSync(AUDIO_DIR)
  .filter(file =>
    /^step_\d+\.wav$/.test(file)
  )
  .sort((a, b) => {
    const aNumber =
      parseInt(a.match(/\d+/)[0]);

    const bNumber =
      parseInt(b.match(/\d+/)[0]);

    return aNumber - bNumber;
  });

if (audioFiles.length === 0) {
  throw new Error(
    "No step_*.wav files found."
  );
}

const durations = [];

for (const file of audioFiles) {
  const filePath = path.join(
    AUDIO_DIR,
    file
  );

  try {
    const output = execFileSync(
      "ffprobe",
      [
        "-i",
        filePath,
        "-show_entries",
        "format=duration",
        "-v",
        "quiet",
        "-of",
        "csv=p=0"
      ],
      {
        encoding: "utf8"
      }
    );

    const rawDuration =
      parseFloat(output.trim());

    if (isNaN(rawDuration)) {
      throw new Error(
        "Invalid duration returned by ffprobe"
      );
    }

    // Buffer prevents the final word from being cut off.
    const duration =
      Number((rawDuration + 0.3).toFixed(2));

    durations.push(duration);

    console.log(
      `${file}: ${duration}s`
    );

  } catch (error) {
    console.error(
      `Failed to read duration for ${file}:`,
      error.message
    );

    process.exit(1);
  }
}

const outputContent = `
// Automatically generated.
// Do not manually edit this file.

export const ragDurations = ${JSON.stringify(
  durations,
  null,
  2
)} as const;
`;

fs.writeFileSync(
  OUTPUT_FILE,
  outputContent.trim() + "\n"
);

console.log(
  `\nGenerated ${OUTPUT_FILE}`
);

console.log(
  `Total audio files: ${durations.length}`
);

const totalDuration =
  durations.reduce(
    (sum, duration) =>
      sum + duration,
    0
  );

console.log(
  `Total duration: ${totalDuration.toFixed(2)} seconds`
);