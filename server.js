const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/match', async (req, res) => {
  const { jd, resume } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  if (!jd || !resume) return res.status(400).json({ error: 'JD and resume are required' });
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const prompt = `You are an expert recruiter. Compare the Job Description and Resume below.
Return a JSON object with exactly these fields:
- score: integer 0-100 (match percentage)
- verdict: "Strong Match" or "Partial Match" or "Weak Match"
- summary: 2-3 sentences explaining why

Respond ONLY with valid JSON. No explanation outside JSON.

JOB DESCRIPTION:
${jd.substring(0, 2000)}

RESUME:
${resume.substring(0, 2000)}

JSON:`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'llama3-8b-8192',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const result = JSON.parse(jsonMatch[0]);
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: 'Something went wrong: ' + e.message });
  }
});

app.get('/', (req, res) => res.send('ResuMatch Server is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ResuMatch server running on port ${PORT}`));
