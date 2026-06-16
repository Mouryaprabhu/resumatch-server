const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/match", async (req, res) => {
  const { jd, resume } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  if (!jd || !resume) {
    return res.json({
      score: 0,
      verdict: "Missing Input",
      summary: "Please provide both Job Description and Resume."
    });
  }

  if (!apiKey) {
    return res.json({
      score: 0,
      verdict: "Server Error",
      summary: "GROQ_API_KEY is missing."
    });
  }

  try {
    const prompt = `
You are a STRICT ATS (Applicant Tracking System) evaluator. Your job is to honestly score how well a resume matches a job description.

STRICT SCORING RULES — follow these exactly:
- 0 to 20%  → Resume has NO relevant skills, experience, or domain match at all
- 21 to 40% → Resume has very little relevance, maybe 1-2 minor overlapping words
- 41 to 60% → Resume has some overlap but is mostly from a different domain
- 61 to 75% → Resume is a partial match — some skills match but key requirements are missing
- 76 to 88% → Resume is a good match — most skills and experience align well
- 89 to 100% → Resume is nearly perfect for this role — almost all requirements met

IMPORTANT RULES:
- Do NOT give high scores just because both documents are professional
- Do NOT give high scores if the candidate's domain/industry is completely different
- Be harsh and realistic — most resumes should score below 60% unless truly relevant
- Compare actual skills, tools, domain, years of experience, and role responsibilities

JOB DESCRIPTION:
${jd.substring(0, 2000)}

RESUME:
${resume.substring(0, 2000)}

Return ONLY this JSON and nothing else:
{
  "score": <number 0-100>,
  "verdict": "<Poor Match | Weak Match | Partial Match | Good Match | Strong Match>",
  "summary": "<2-3 sentences explaining exactly why this score was given>",
  "matched_skills": ["<skill1>", "<skill2>"],
  "missing_skills": ["<skill1>", "<skill2>"]
}
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
          temperature: 0,
          max_tokens: 400,
          messages: [{ role: "user", content: prompt }]
        })
      }
    );

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    console.log("AI Response:", raw);

    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");

    if (first === -1 || last === -1) {
      return res.json({
        score: 0,
        verdict: "AI Error",
        summary: "AI did not return valid JSON."
      });
    }

    const jsonString = raw.substring(first, last + 1);
    let result;

    try {
      result = JSON.parse(jsonString);
    } catch {
      return res.json({
        score: 0,
        verdict: "Parse Error",
        summary: raw
      });
    }

    return res.json({
      score: Number(result.score) || 0,
      verdict: result.verdict || "Unknown",
      summary: result.summary || "No summary available.",
      matched_skills: result.matched_skills || [],
      missing_skills: result.missing_skills || []
    });

  } catch (err) {
    console.log(err);
    return res.json({
      score: 0,
      verdict: "Server Error",
      summary: err.message
    });
  }
});

app.get("/", (req, res) => {
  res.send("ResuMatch Server Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
