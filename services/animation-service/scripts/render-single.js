import fs from 'fs/promises';
import { renderVideo } from '@revideo/renderer';
import path from 'path';

async function main() {
  const scene = process.argv[2];
  if (!scene) {
    console.error("Usage: node render-single.js <SceneName>");
    process.exit(1);
  }

  const rawDir = path.join(process.cwd(), 'render-output', 'raw');
  await fs.mkdir(rawDir, { recursive: true });

  console.log(`\n=== Rendering ${scene} (Child Process) ===`);
  const tempProjFile = path.join(process.cwd(), 'src', `temp-project-${scene}.ts`).replace(/\\/g, '/');
  const code = `import { makeProject } from '@revideo/core';\nimport scene from './scenes/${scene}.js';\nexport default makeProject({ scenes: [scene] });`;
  await fs.writeFile(tempProjFile, code);
  
  await new Promise(r => setTimeout(r, 2000));

  try {
    const puppeteerOpts = {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--enable-features=WebCodecs',
        '--use-gl=swiftshader',
        '--enable-unsafe-webgpu',
        '--disable-features=AudioServiceOutOfProcess'
      ]
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      puppeteerOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    await renderVideo({
      projectFile: tempProjFile,
      settings: {
        outDir: 'render-output/raw',
        outFile: `${scene}.mp4`,
        logProgress: true,
        puppeteer: puppeteerOpts
      }
    });
  } catch (err) {
    console.error(`Failed to render ${scene}:`, err);
    process.exit(1);
  } finally {
    try { await fs.unlink(tempProjFile); } catch (e) {}
  }
}

main();
