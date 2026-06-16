const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.post('/match', async (req, res) => {
  const { jd, resume } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  // Validate input
  if (!jd || !resume) {
    return res.status(400).json({
      error: 'Job Description and Resume are required.'
    });
  }

  // Validate API key
  if (!apiKey) {
    return res.status(500).json({
      error: 'GROQ_API_KEY is not configured.'
    });
  }

  try {
    const prompt = `
You are an expert recruiter.

Compare the following Job Description and Resume.

Return ONLY valid JSON in this format:

{
  "score": 85,
  "verdict": "Strong Match",
  "summary": "The candidate matches most required skills and experience."
}

JOB DESCRIPTION:
${jd.substring(0, 2000)}

RESUME:
${resume.substring(0, 2000)}
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 300,
        }),
      }
    );

    const data = await response.json();

    console.log("Groq Response:");
    console.log(JSON.stringify(data, null, 2));

    // Check if Groq returned an error
    if (data.error) {
      return res.status(500).json({
        error: data.error.message || "Groq API Error",
      });
    }

    const raw = data?.choices?.[0]?.message?.content;

    // Prevent "undefined.match()" error
    if (!raw) {
      return res.status(500).json({
        error: "Groq did not return any content.",
        response: data,
      });
    }

    const jsonMatch = raw.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return res.status(500).json({
        error: "Groq returned invalid JSON.",
        raw: raw,
      });
    }

    const result = JSON.parse(jsonMatch[0]);

    res.json(result);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message,
    });
  }
});

app.get("/", (req, res) => {
  res.send("✅ ResuMatch Server is running!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
