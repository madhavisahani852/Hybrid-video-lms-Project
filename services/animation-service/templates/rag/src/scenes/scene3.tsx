import { makeScene2D, Rect, Txt, Line, Circle } from '@revideo/2d';
import { all, chain, createRef, waitFor } from '@revideo/core';
import { THEME } from '../utils/theme';
import { Background } from '../components/Background';
import { Card } from '../components/Card';
import { Caption } from '../components/Caption';
import { Badge } from '../components/Badge';
import { popIn } from '../animations/pop';
import { fadeIn } from '../animations/fade';
import { drawIn } from '../animations/draw';
import { typeText } from '../animations/typing';

export default makeScene2D('scene3', function* (view) {
  const cameraRef = createRef<Rect>();
  const titleRef = createRef<Rect>();
  const timelineGroupRef = createRef<Rect>();

  const timelineLineRef = createRef<Line>();
  const year2023Ref = createRef<Circle>();
  const year2024Ref = createRef<Circle>();
  const cutoffRef = createRef<Rect>(); // Cutoff warning card
  const event2026Ref = createRef<Rect>(); // Event card

  const captionRef = createRef<Rect>();

  view.add(
    <Background>
      <Rect ref={cameraRef} size={['100%', '100%']} justifyContent={'center'} alignItems={'center'}>

        {/* Title */}
        <Rect ref={titleRef} y={-400} opacity={0}>
          <Txt
            fontFamily={THEME.fonts.main}
            fontSize={48}
            fontWeight={800}
            fill={THEME.colors.warning}
            text={'The Problem: Knowledge Cutoff'}
          />
        </Rect>

        {/* Timeline Group */}
        <Rect ref={timelineGroupRef} width={1200} height={300} y={-50}>
          {/* Main timeline line */}
          <Line
            ref={timelineLineRef}
            points={[[-500, 0], [500, 0]]}
            lineWidth={6}
            stroke={THEME.colors.textDark}
            end={0}
          />

          {/* 2023 Point */}
          <Circle
            ref={year2023Ref}
            x={-350}
            y={0}
            size={24}
            fill={THEME.colors.textMuted}
            opacity={0}
          >
            <Txt
              y={40}
              fontFamily={THEME.fonts.main}
              fontSize={20}
              fontWeight={700}
              fill={THEME.colors.textMuted}
              text={'2023'}
            />
          </Circle>

          {/* 2024 Point */}
          <Circle
            ref={year2024Ref}
            x={-100}
            y={0}
            size={24}
            fill={THEME.colors.textMuted}
            opacity={0}
          >
            <Txt
              y={40}
              fontFamily={THEME.fonts.main}
              fontSize={20}
              fontWeight={700}
              fill={THEME.colors.textMuted}
              text={'2024'}
            />
          </Circle>

          {/* Cutoff Marker Card at 2025 */}
          <Card
            ref={cutoffRef}
            x={150}
            y={-120}
            width={260}
            height={130}
            opacity={0}
            glowColor={THEME.colors.warning}
            showGlow={true}
          >
            <Badge text={'CUTOFF DATE'} color={THEME.colors.warning} marginBottom={6} />
            <Txt
              fontFamily={THEME.fonts.main}
              fontSize={24}
              fontWeight={800}
              fill={THEME.colors.text}
              text={'January 2025'}
              textAlign={'center'}
            />
          </Card>
          <Circle
            x={150}
            y={0}
            size={32}
            fill={THEME.colors.warning}
            shadowColor={THEME.colors.warning}
            shadowBlur={15}
          />

          {/* 2026 Event Card */}
          <Card
            ref={event2026Ref}
            x={450}
            y={120}
            width={260}
            height={130}
            opacity={0}
            glowColor={THEME.colors.error}
          >
            <Badge text={'FUTURE EVENT'} color={THEME.colors.error} marginBottom={6} />
            <Txt
              fontFamily={THEME.fonts.main}
              fontSize={20}
              fontWeight={700}
              fill={THEME.colors.textMuted}
              text={'New Event (2026)'}
              textAlign={'center'}
            />
          </Card>
          <Circle
            x={450}
            y={0}
            size={24}
            fill={THEME.colors.textDark}
          />
        </Rect>

        {/* Subtitles / Caption */}
        <Caption
          ref={captionRef}
          text={''}
          y={350}
          opacity={0}
        />

      </Rect>
    </Background>
  );

  const captionTxt = captionRef().children()[0] as Txt;

  yield* all(
    // Slow camera drift
    cameraRef().scale(1.04, 8),
    cameraRef().position.y(-10, 8),

    // Scene animation sequence
    chain(
      waitFor(1),

      // Fade in Title
      fadeIn(titleRef(), 2),
      waitFor(2),

      // Draw timeline
      drawIn(timelineLineRef(), 2),
      waitFor(2),

      // Fade in points 2023 & 2024
      all(
        fadeIn(year2023Ref(), 2),
        fadeIn(year2024Ref(), 2)
      ),
      waitFor(2),

      // Pop in the Cutoff date
      popIn(cutoffRef(), 2),
      waitFor(2),

      // Pop in the 2026 Future event (past the cutoff date)
      popIn(event2026Ref(), 2),
      waitFor(2),

      // Fade in Caption
      fadeIn(captionRef(), 2),
      typeText(captionTxt, 'LLMs are limited by a static knowledge cutoff date. They are blind to events after this point.', 2.8),

      waitFor(5)
    )
  );
});
