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
You are an ATS Resume Matcher.
Compare the Job Description and Resume.
IMPORTANT:
Return ONLY this JSON.
{
  "score": number,
  "verdict": "Strong Match",
  "summary": "2-3 sentence explanation"
}
Do not write anything before or after JSON.
JOB DESCRIPTION:
${jd.substring(0,2000)}
RESUME:
${resume.substring(0,2000)}
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
          max_tokens: 250,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      }
    );
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    console.log(raw);
    // Extract ONLY JSON
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
      summary: result.summary || "No summary available."
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
