/**
 * Script & Avatar Prompt Generator Service
 * Uses Google Gemini API if GEMINI_API_KEY is provided, or falls back to built-in intelligent templates.
 */
export async function generateScriptAndPrompt({ topic, durationMinutes = 1, targetAudience = 'general', apiKey = '' }) {
  const geminiKey = apiKey || process.env.GEMINI_API_KEY;

  if (geminiKey) {
    try {
      const promptText = `
You are an expert AI YouTube Shorts / Instagram Reels scriptwriter and visual director.
Task: Create a compelling ${durationMinutes}-minute video script on the topic: "${topic}". Target audience: "${targetAudience}".

Return ONLY a valid JSON object with the following keys:
{
  "title": "Catchy title for the clip",
  "scriptText": "The full spoken transcript of the video. Keep it engaging, clear, and timed for approximately ${durationMinutes * 140} words.",
  "avatarPrompt": "Detailed visual description of a realistic AI presenter portrait (e.g. 'A professional tech presenter, 28 year old female, studio lighting, hyperrealistic, 8k portrait').",
  "keyTakeaways": ["Point 1", "Point 2", "Point 3"]
}
`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleanJson = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson);
      }
    } catch (err) {
      console.warn('[ScriptService] Gemini API failed or invalid response. Falling back to template generator.', err.message);
    }
  }

  // Fallback Template Generator ($0, No API Key Required)
  const targetWords = Math.min(Math.max(durationMinutes * 130, 100), 400);
  const scriptText = `Welcome to today's quick update on ${topic}! Did you know that ${topic} is transforming how creators generate high quality content online? In this short video, we break down three key insights you need to know right now. First, AI powered tools are making video creation accessible to everyone without expensive hardware. Second, automation workflows save up to eighty percent of editing time. And third, staying ahead of technology allows you to produce consistent engaging clips every day. If you found this helpful, hit subscribe and share your thoughts in the comments below!`;

  return {
    title: `Mastering ${topic} in ${durationMinutes} Minute`,
    scriptText: scriptText,
    avatarPrompt: `A confident modern professional presenter, photorealistic 8k portrait, studio lighting, cinematic bokeh background, ultra detailed face`,
    keyTakeaways: [
      `Key trends in ${topic}`,
      'Automated zero-cost workflows',
      'High engagement content strategy'
    ]
  };
}
