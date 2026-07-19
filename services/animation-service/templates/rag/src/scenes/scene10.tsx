import { makeScene2D, Rect, Txt, Line } from '@revideo/2d';
import { all, chain, createRef, waitFor } from '@revideo/core';
import { THEME } from '../utils/theme';
import { Background } from '../components/Background';
import { Card } from '../components/Card';
import { PromptBox } from '../components/PromptBox';
import { Caption } from '../components/Caption';
import { Badge } from '../components/Badge';
import { AnimatedArrow } from '../components/AnimatedArrow';
import { popIn } from '../animations/pop';
import { fadeIn } from '../animations/fade';
import { drawIn } from '../animations/draw';
import { typeText } from '../animations/typing';

export default makeScene2D('scene10', function* (view) {
  const cameraRef = createRef<Rect>();
  const titleRef = createRef<Rect>();

  const questionCardRef = createRef<Rect>();
  const contextCardRef = createRef<Rect>();

  const arrow1Ref = createRef<Line>();
  const arrow2Ref = createRef<Line>();

  const promptBoxContainerRef = createRef<Rect>();
  const promptBoxRef = createRef<Rect>();

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
            fill={THEME.colors.primary}
            text={'Prompt Augmentation'}
          />
        </Rect>

        {/* User Question Card */}
        <Card
          ref={questionCardRef}
          x={-450}
          y={-120}
          width={320}
          height={140}
          opacity={0}
        >
          <Badge text={'QUESTION'} color={THEME.colors.primary} marginBottom={6} />
          <Txt fontFamily={THEME.fonts.main} fontSize={18} fill={THEME.colors.text} text={'“What is RAG?”'} />
        </Card>

        {/* Retrieved Context Card */}
        <Card
          ref={contextCardRef}
          x={-450}
          y={120}
          width={320}
          height={140}
          opacity={0}
          glowColor={THEME.colors.cyan}
        >
          <Badge text={'RETRIEVED CONTEXT'} color={THEME.colors.cyan} marginBottom={6} />
          <Txt fontFamily={THEME.fonts.main} fontSize={14} fill={THEME.colors.textMuted} text={'“RAG is a pipeline combining retriever models with LLMs.”'} textWrap={true} />
        </Card>

        {/* Arrow 1: Question -> PromptBox */}
        <AnimatedArrow
          ref={arrow1Ref}
          points={[[-270, -120], [-50, -120], [0, -50]]}
          glowColor={THEME.colors.primary}
        />

        {/* Arrow 2: Context -> PromptBox */}
        <AnimatedArrow
          ref={arrow2Ref}
          points={[[-270, 120], [-50, 120], [0, 50]]}
          glowColor={THEME.colors.cyan}
        />

        {/* Augmented Prompt Box */}
        <Rect ref={promptBoxContainerRef} x={280} y={0} opacity={0}>
          <PromptBox
            ref={promptBoxRef}
            questionText={'What is RAG?'}
            contextText={'RAG is a pipeline combining retriever models with LLMs.'}
            glow={false}
          />
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

  const captionTxt = captionRef().children()[0] as Txt;

  yield* all(
    // Slow camera drift
    cameraRef().scale(1.04, 20),
    cameraRef().position.y(-10, 20),

    // Scene animation sequence
    chain(
      waitFor(1),

      // Fade in Title
      fadeIn(titleRef(), 0.6),

      // Pop in original question and context cards
      all(
        popIn(questionCardRef(), 0.6),
        popIn(contextCardRef(), 0.6)
      ),
      waitFor(2),

      // Pop in target prompt assembler
      popIn(promptBoxContainerRef(), 0.8),
      waitFor(2),

      // Draw merging arrows
      all(
        drawIn(arrow1Ref(), 0.7),
        drawIn(arrow2Ref(), 0.7)
      ),
      waitFor(2),

      // Make target prompt glow
      all(
        promptBoxRef().stroke(THEME.colors.primary, 0.4),
        promptBoxRef().shadowColor(THEME.colors.primary, 0.4),
        promptBoxRef().shadowBlur(25, 0.4)
      ),
      waitFor(2),

      // Caption
      fadeIn(captionRef(), 0.5),
      typeText(captionTxt, 'We inject the retrieved context alongside the user question, packing them into an augmented prompt.', 2.8),

      waitFor(15)
    )
  );
});
