const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/match", async (req, res) => {
  const { jd, resume } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  if (!jd || !resume) {
    return res.status(400).json({
      score: 0,
      verdict: "Invalid Input",
      summary: "Please provide both Job Description and Resume."
    });
  }

  if (!apiKey) {
    return res.status(500).json({
      score: 0,
      verdict: "Server Error",
      summary: "Groq API key is missing."
    });
  }

  try {
    const prompt = `
You are an expert recruiter.

Compare the following Job Description and Resume.

Return ONLY valid JSON.

Example:

{
  "score": 85,
  "verdict": "Strong Match",
  "summary": "The resume matches most required skills and experience."
}

Job Description:
${jd.substring(0, 2500)}

Resume:
${resume.substring(0, 2500)}
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.1,
          max_tokens: 300
        })
      }
    );

    const data = await response.json();

    console.log(data);

    if (data.error) {
      return res.json({
        score: 0,
        verdict: "API Error",
        summary: data.error.message
      });
    }

    let raw = data?.choices?.[0]?.message?.content || "";

    raw = raw
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    let result;

    try {
      result = JSON.parse(raw);
    } catch (e) {
      const match = raw.match(/\{[\s\S]*\}/);

      if (match) {
        result = JSON.parse(match[0]);
      } else {
        result = {
          score: 0,
          verdict: "Unable to Parse",
          summary: raw
        };
      }
    }

    result.score = Number(result.score) || 0;
    result.verdict = result.verdict || "No Verdict";
    result.summary = result.summary || "No summary returned.";

    res.json(result);

  } catch (error) {
    console.log(error);

    res.json({
      score: 0,
      verdict: "Server Error",
      summary: error.message
    });
  }
});

app.get("/", (req, res) => {
  res.send("ResuMatch Server Running Successfully");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
