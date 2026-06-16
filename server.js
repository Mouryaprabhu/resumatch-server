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
      relevant: false,
      verdict: "Missing Input",
      summary: "Please provide both Job Description and Resume."
    });
  }

  if (!apiKey) {
    return res.json({
      score: 0,
      relevant: false,
      verdict: "Server Error",
      summary: "GROQ_API_KEY is missing."
    });
  }

  try {
    const prompt = `
You are an expert ATS (Applicant Tracking System) evaluator with 10 years of recruiting experience.

Carefully read the Job Description and Resume below.

YOUR MAIN JOB:
First decide — is this resume RELEVANT or IRRELEVANT for this job?

RELEVANT means:
- The candidate's domain/industry matches the job
- At least 40% of required skills are present
- The job role/title is similar or related
- The candidate has done similar work before

IRRELEVANT means:
- The candidate is from a completely different field
- Less than 20% skills match
- The job role has nothing to do with candidate's background
- It is clearly the wrong person for this job

SCORING GUIDE (after deciding relevant/irrelevant):
- IRRELEVANT resumes: score between 0-35% only
- RELEVANT resumes: score between 40-95% based on how well they match

JOB DESCRIPTION:
${jd.substring(0, 2000)}

RESUME:
${resume.substring(0, 2000)}

Return ONLY valid JSON, nothing else:
{
  "score": <number 0-100>,
  "relevant": <true or false>,
  "verdict": "<Irrelevant | Poor Match | Weak Match | Partial Match | Good Match | Strong Match>",
  "summary": "<2-3 sentences with specific reasons why this resume is relevant or irrelevant>",
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
          model: "llama-3.3-70b-versatile",
          temperature: 0,
          max_tokens: 500,
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
        relevant: false,
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
        relevant: false,
        verdict: "Parse Error",
        summary: raw
      });
    }

    return res.json({
      score: Number(result.score) || 0,
      relevant: result.relevant === true,
      verdict: result.verdict || "Unknown",
      summary: result.summary || "No summary available.",
      matched_skills: result.matched_skills || [],
      missing_skills: result.missing_skills || []
    });

  } catch (err) {
    console.log(err);
    return res.json({
      score: 0,
      relevant: false,
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
