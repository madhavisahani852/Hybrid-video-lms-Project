import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs-extra';
import path from 'path';

/**
 * Get Audio Duration in seconds
 */
export function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata?.format?.duration || 0;
      resolve(duration);
    });
  });
}

/**
 * Split Audio File into ~chunkDurationSec segments
 */
export function splitAudioIntoChunks(audioPath, outputDir, chunkDurationSec = 20) {
  return new Promise(async (resolve, reject) => {
    try {
      const totalDuration = await getAudioDuration(audioPath);
      const numChunks = Math.ceil(totalDuration / chunkDurationSec);
      const chunkPaths = [];

      await fs.ensureDir(outputDir);

      let completed = 0;
      if (numChunks <= 1) {
        // Return single audio file
        return resolve([audioPath]);
      }

      for (let i = 0; i < numChunks; i++) {
        const startTime = i * chunkDurationSec;
        const chunkPath = path.join(outputDir, `chunk_${i}.mp3`);
        chunkPaths.push(chunkPath);

        ffmpeg(audioPath)
          .setStartTime(startTime)
          .setDuration(chunkDurationSec)
          .output(chunkPath)
          .on('end', () => {
            completed++;
            if (completed === numChunks) {
              resolve(chunkPaths);
            }
          })
          .on('error', (err) => reject(err))
          .run();
      }
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Concatenate multiple video files into a single final MP4 and merge original master audio
 */
export function concatenateVideos(videoPaths, masterAudioPath, outputPath) {
  return new Promise((resolve, reject) => {
    if (!videoPaths || videoPaths.length === 0) {
      return reject(new Error('No video paths provided for concatenation'));
    }

    if (videoPaths.length === 1) {
      // Just overlay master audio if single clip
      ffmpeg(videoPaths[0])
        .input(masterAudioPath)
        .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0', '-shortest'])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (err) => reject(err))
        .run();
      return;
    }

    // Write file list for FFmpeg concat filter
    const listFilePath = path.join(path.dirname(outputPath), 'concat_list.txt');
    const fileContent = videoPaths.map(p => `file '${path.resolve(p).replace(/'/g, "'\\\\''")}'`).join('\n');
    fs.writeFileSync(listFilePath, fileContent);

    const tempConcatVideo = path.join(path.dirname(outputPath), 'temp_concat.mp4');

    ffmpeg()
      .input(listFilePath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(tempConcatVideo)
      .on('end', () => {
        // Merge master audio onto concatenated video
        ffmpeg(tempConcatVideo)
          .input(masterAudioPath)
          .outputOptions(['-c:v copy', '-c:a aac', '-map 0:v:0', '-map 1:a:0', '-shortest'])
          .output(outputPath)
          .on('end', () => {
            fs.removeSync(listFilePath);
            fs.removeSync(tempConcatVideo);
            resolve(outputPath);
          })
          .on('error', (err) => reject(err))
          .run();
      })
      .on('error', (err) => reject(err))
      .run();
  });
}
