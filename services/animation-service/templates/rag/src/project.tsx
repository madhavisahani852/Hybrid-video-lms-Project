import { makeProject } from '@revideo/core';
import scene1 from './scenes/scene1';
import scene2 from './scenes/scene2';
import scene3 from './scenes/scene3';
import scene4 from './scenes/scene4';
import scene6 from './scenes/scene6';
import scene8 from './scenes/scene8';
import scene12 from './scenes/scene12';
import scene13 from './scenes/scene13';
import scene14 from './scenes/scene14';
import scene15 from './scenes/scene15';
import scene16 from './scenes/scene16';
import scene17 from './scenes/scene17';
import scene18 from './scenes/scene18';
import scene19 from './scenes/scene19';
import scene20 from './scenes/scene20';
import scene21 from './scenes/scene21';
import scene22 from './scenes/scene22';
import scene23 from './scenes/scene23';
import scene24 from './scenes/scene24';
import scene25 from './scenes/scene25';
import scene26 from './scenes/scene26';
import scene27 from './scenes/scene27';
import scene28 from './scenes/scene28';
import scene29 from './scenes/scene29';


/**
 * RAG Educational Video Presentation
 * Registers 30 thematic stages of the RAG pipeline.
 */
export default makeProject({
  scenes: [
    scene1,
    scene2,
    scene3,
    scene4,
    scene6,
    scene18,
    scene14,
    scene15,
    scene8,
    scene13,
    scene16,
    scene17,
    scene19,
    scene20,
    scene21,
    scene22,
    scene23,
    scene24,
    scene25,
    scene26,
    scene27,
    scene28,
    scene29,
    scene12,

  ],
  settings: {
    shared: {
      size: { x: 1920, y: 1080 },
    },
  },
});
