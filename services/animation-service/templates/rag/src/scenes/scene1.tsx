import { makeScene2D, Rect, Txt } from '@revideo/2d';
import { all, chain, createRef, waitFor } from '@revideo/core';
import { THEME } from '../utils/theme';
import { Background } from '../components/Background';
import { Title } from '../components/Title';
import { Caption } from '../components/Caption';
import { Badge } from '../components/Badge';
import { popIn } from '../animations/pop';
import { fadeIn } from '../animations/fade';
import { typeText } from '../animations/typing';

export default makeScene2D('scene1', function* (view) {
  const cameraRef = createRef<Rect>();
  const titleRef = createRef<Rect>();
  const badgesRef = createRef<Rect>();
  const captionRef = createRef<Rect>();
  const captionTextRef = createRef<Txt>();

  // Add background and camera wrapper
  view.add(
    <Background>
      <Rect ref={cameraRef} size={['50%', '50%']} justifyContent={'center'} alignItems={'center'}>
        {/* Title */}
        <Title
          ref={titleRef}
          titleText={'Retrieval-Augmented Generation'}
          subtitleText={'An Educational Guide to RAG'}
          y={-100}
        />

        {/* Badges Container */}
        <Rect
          ref={badgesRef}
          layout
          direction={'row'}
          gap={32}
          y={100}
          opacity={0}
        >
          <Badge text={'ACCURACY'} color={THEME.colors.primary} />
          <Badge text={'KNOWLEDGE'} color={THEME.colors.cyan} />
          <Badge text={'LLM'} color={THEME.colors.purple} />
        </Rect>

        {/* Caption */}
        <Caption
          ref={captionRef}
          text={''}
          y={350}
          opacity={0}
        />
      </Rect>
    </Background>
  );

  // Setup refs for Caption's internal Txt node
  // We can query the first Txt child of the caption node
  const captionTxt = captionRef().children()[0] as Txt;

  // Run continuous cinematic camera movement in parallel with scene animations
  yield* all(
    // Slow camera zoom and horizontal pan
    cameraRef().scale(1.04, 8),
    cameraRef().position.y(-10, 8),

    // Scene animation sequence
    chain(
      waitFor(0.5),

      // Pop in title
      popIn(titleRef(), 0.8),
      waitFor(0.5),

      // Fade in badges
      fadeIn(badgesRef(), 0.6),
      waitFor(0.5),

      // Fade in Caption container
      fadeIn(captionRef(), 0.5),

      // Type out explanation text
      typeText(captionTxt, 'Retrieval-Augmented Generation (RAG) is a technique that enhances LLMs with external data.', 2.5),

      // Wait for the remainder of the 75s duration
      waitFor(15)
    )
  );
});
