const express = require("express");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.post("/match", async (req, res) => {
  const { jd, resume } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!jd || !resume) return res.json({ score: 0, relevant: false, verdict: "Missing Input", summary: "Please provide both Job Description and Resume." });
  if (!apiKey) return res.json({ score: 0, relevant: false, verdict: "Server Error", summary: "GROQ_API_KEY is missing." });
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
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0, max_tokens: 500, messages: [{ role: "user", content: prompt }] })
    });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const first = raw.indexOf("{"); const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) return res.json({ score: 0, relevant: false, verdict: "AI Error", summary: "AI did not return valid JSON." });
    const jsonString = raw.substring(first, last + 1);
    let result;
    try { result = JSON.parse(jsonString); } catch { return res.json({ score: 0, relevant: false, verdict: "Parse Error", summary: raw }); }
    return res.json({ score: Number(result.score) || 0, relevant: result.relevant === true, verdict: result.verdict || "Unknown", summary: result.summary || "No summary available.", matched_skills: result.matched_skills || [], missing_skills: result.missing_skills || [] });
  } catch (err) { return res.json({ score: 0, relevant: false, verdict: "Server Error", summary: err.message }); }
});

app.post("/extract", async (req, res) => {
  const { resume } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!resume) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "No resume text provided." });
  if (!apiKey) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "GROQ_API_KEY is missing." });
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
- Extract phone numbers exactly as written
- For education, keep it short (degree + institution only)
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
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0, max_tokens: 300, messages: [{ role: "user", content: prompt }] })
    });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const first = raw.indexOf("{"); const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "AI did not return valid JSON." });
    const jsonString = raw.substring(first, last + 1);
    let result;
    try { result = JSON.parse(jsonString); } catch { return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "Could not parse AI response." }); }
    return res.json({ name: result.name || "", phone: result.phone || "", email: result.email || "", city: result.city || "", education: result.education || "" });
  } catch (err) { return res.json({ name: "", phone: "", email: "", city: "", education: "", error: err.message }); }
});

app.post("/generate-jd", async (req, res) => {
  const { jobTitle, department, experience, skills, location, employmentType } = req.body;
  const apiKey = process.env.GROQ_API_KEY;
  if (!jobTitle) return res.json({ error: "Job title is required." });
  if (!apiKey) return res.json({ error: "GROQ_API_KEY is missing." });
  try {
    const prompt = `You are an expert HR professional. Generate a job description and return ONLY a JSON object with no extra text, no markdown, no code blocks.

Job Details:
- Title: ${jobTitle}
- Department: ${department || 'General'}
- Experience: ${experience || 'Not specified'}
- Skills: ${skills || 'Not specified'}
- Location: ${location || 'Not specified'}
- Type: ${employmentType || 'Full Time'}

Return this exact JSON structure:
{"structured":{"about":"2-3 sentences about the role","responsibilities":["responsibility 1","responsibility 2","responsibility 3","responsibility 4","responsibility 5","responsibility 6"],"qualifications":["qualification 1","qualification 2","qualification 3","qualification 4","qualification 5"],"preferred":["preferred skill 1","preferred skill 2","preferred skill 3"],"benefits":["benefit 1","benefit 2","benefit 3","benefit 4"]},"plain":"Full plain text JD here with all sections"}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
        max_tokens: 2000,
        messages: [
          { role: "system", content: "You are a JSON generator. Always respond with valid JSON only. No markdown, no code blocks, no extra text. Just raw JSON." },
          { role: "user", content: prompt }
        ]
      })
    });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    console.log("JD Generator raw response:", raw.substring(0, 200));

    // Try to extract JSON even if there's extra text
    let jsonString = raw.trim();
    // Remove markdown code blocks if present
    jsonString = jsonString.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = jsonString.indexOf("{");
    const last = jsonString.lastIndexOf("}");
    if (first === -1 || last === -1) return res.json({ error: "AI did not return valid JSON." });
    jsonString = jsonString.substring(first, last + 1);

    let result;
    try {
      result = JSON.parse(jsonString);
    } catch (parseErr) {
      console.log("Parse error:", parseErr.message);
      // If JSON parse fails, build a fallback structured response from the raw text
      return res.json({
        structured: {
          about: `This is a ${jobTitle} position at ${department || 'our company'} based in ${location || 'our offices'}.`,
          responsibilities: ["Lead and manage key projects", "Collaborate with cross-functional teams", "Drive innovation and best practices", "Mentor junior team members", "Report progress to stakeholders"],
          qualifications: [`${experience || '3+'} years of relevant experience`, `Strong knowledge of ${skills || 'relevant tools'}`, "Excellent communication skills", "Bachelor's degree in relevant field"],
          preferred: ["Experience with agile methodologies", "Strong problem-solving skills", "Ability to work in a fast-paced environment"],
          benefits: ["Competitive salary", "Health insurance", "Flexible working hours", "Learning & development opportunities"]
        },
        plain: raw
      });
    }

    return res.json({ structured: result.structured, plain: result.plain });
  } catch (err) {
    console.log("JD Generator error:", err.message);
    return res.json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.send("ResuMatch Server Running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
