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

app.post("/extract", async (req, res) => {
  const { resume } = req.body;
  const apiKey = process.env.GROQ_API_KEY;

  if (!resume) {
    return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "No resume text provided." });
  }
  if (!apiKey) {
    return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "GROQ_API_KEY is missing." });
  }

  try {
    const prompt = `
You are a resume data extraction expert. Extract ONLY these 5 fields from the resume text below:

1. Name - the candidate's full name
2. Phone - phone number (if multiple, pick the primary one)
3. Email - email address
4. City - current city/location of the candidate
5. Education - highest degree and institution (e.g. "B.Tech, IIT Delhi")

RULES:
- If a field is not found in the resume, return an empty string "" for that field
- Do not guess or invent information
- Extract phone numbers exactly as written (keep country code if present)
- For education, keep it short (degree + institution only, not full descriptions)

RESUME TEXT:
${resume.substring(0, 3000)}

Return ONLY this JSON and nothing else:
{
  "name": "",
  "phone": "",
  "email": "",
  "city": "",
  "education": ""
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
          max_tokens: 300,
          messages: [{ role: "user", content: prompt }]
        })
      }
    );

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    console.log("Extract AI Response:", raw);

    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");

    if (first === -1 || last === -1) {
      return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "AI did not return valid JSON." });
    }

    const jsonString = raw.substring(first, last + 1);
    let result;

    try {
      result = JSON.parse(jsonString);
    } catch {
      return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "Could not parse AI response." });
    }

    return res.json({
      name: result.name || "",
      phone: result.phone || "",
      email: result.email || "",
      city: result.city || "",
      education: result.education || ""
    });

  } catch (err) {
    console.log(err);
    return res.json({ name: "", phone: "", email: "", city: "", education: "", error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("ResuMatch Server Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
