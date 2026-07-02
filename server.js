const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mammoth = require("mammoth");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── Extract text from uploaded file ─────────────────────────────────
async function extractTextFromFile(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();
  if (ext === 'pdf') {
    // Extract PDF text using basic byte reading
    const bytes = new Uint8Array(file.buffer);
    let text = '', chunk = '';
    for (let i = 0; i < bytes.length; i++) {
      const c = bytes[i];
      if (c >= 32 && c < 127) chunk += String.fromCharCode(c);
      else { if (chunk.length > 4) text += chunk + ' '; chunk = ''; }
    }
    return text.replace(/\s+/g, ' ').trim();
  } else if (ext === 'docx') {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value.replace(/\s+/g, ' ').trim();
  } else if (ext === 'doc') {
    // Basic .doc text extraction
    const text = file.buffer.toString('latin1').replace(/[^\x20-\x7E\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
    return text;
  } else {
    return file.buffer.toString('utf-8').replace(/\s+/g, ' ').trim();
  }
}

// ── MATCH endpoint ───────────────────────────────────────────────────
app.post("/match", upload.fields([{ name: 'resumeFile', maxCount: 1 }]), async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  let jd = req.body.jd || '';
  let resume = req.body.resume || '';

  // If file uploaded, extract text from it
  if (req.files && req.files.resumeFile) {
    resume = await extractTextFromFile(req.files.resumeFile[0]);
  }

  if (!jd || !resume) return res.json({ score: 0, relevant: false, verdict: "Missing Input", summary: "Please provide both Job Description and Resume." });
  if (!apiKey) return res.json({ score: 0, relevant: false, verdict: "Server Error", summary: "GROQ_API_KEY is missing." });
  if (resume.length < 50) return res.json({ score: 0, relevant: false, verdict: "Could not read file", summary: "Could not extract text from the uploaded file. Please paste resume text manually." });

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
IRRELEVANT means:
- The candidate is from a completely different field
- Less than 20% skills match
- The job role has nothing to do with candidate's background
SCORING GUIDE:
- IRRELEVANT resumes: score between 0-35% only
- RELEVANT resumes: score between 40-95% based on how well they match
JOB DESCRIPTION:
${jd.substring(0, 2000)}
RESUME:
${resume.substring(0, 2000)}
Return ONLY valid JSON:
{
  "score": <number 0-100>,
  "relevant": <true or false>,
  "verdict": "<Irrelevant | Poor Match | Weak Match | Partial Match | Good Match | Strong Match>",
  "summary": "<2-3 sentences with specific reasons>",
  "matched_skills": ["<skill1>", "<skill2>"],
  "missing_skills": ["<skill1>", "<skill2>"]
}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0, max_tokens: 500, messages: [{ role: "user", content: prompt }] })
    });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const first = raw.indexOf("{"); const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) return res.json({ score: 0, relevant: false, verdict: "AI Error", summary: "AI did not return valid JSON." });
    let result;
    try { result = JSON.parse(raw.substring(first, last + 1)); } catch { return res.json({ score: 0, relevant: false, verdict: "Parse Error", summary: raw }); }
    return res.json({ score: Number(result.score) || 0, relevant: result.relevant === true, verdict: result.verdict || "Unknown", summary: result.summary || "", matched_skills: result.matched_skills || [], missing_skills: result.missing_skills || [] });
  } catch (err) { return res.json({ score: 0, relevant: false, verdict: "Server Error", summary: err.message }); }
});

// ── EXTRACT endpoint ─────────────────────────────────────────────────
app.post("/extract", upload.fields([{ name: 'resumeFile', maxCount: 1 }]), async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  let resume = req.body.resume || '';

  // If file uploaded, extract text from it
  if (req.files && req.files.resumeFile) {
    resume = await extractTextFromFile(req.files.resumeFile[0]);
  }

  if (!resume) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "No resume text provided." });
  if (!apiKey) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "GROQ_API_KEY is missing." });
  if (resume.length < 30) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "Could not read file. Try a different format." });

  try {
    const prompt = `
You are a resume data extraction expert. Extract ONLY these 5 fields from the resume text below:
1. Name - the candidate's full name
2. Phone - phone number (if multiple, pick the primary one)
3. Email - email address
4. City - current city/location of the candidate
5. Education - highest degree and institution (e.g. "B.Tech, IIT Delhi")
RULES:
- If a field is not found, return empty string ""
- Do not guess or invent information
- Extract phone numbers exactly as written
- For education, keep it short (degree + institution only)
RESUME TEXT:
${resume.substring(0, 3000)}
Return ONLY this JSON:
{
  "name": "",
  "phone": "",
  "email": "",
  "city": "",
  "education": ""
}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0, max_tokens: 300, messages: [{ role: "user", content: prompt }] })
    });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const first = raw.indexOf("{"); const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "AI did not return valid JSON." });
    let result;
    try { result = JSON.parse(raw.substring(first, last + 1)); } catch { return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "Could not parse AI response." }); }
    return res.json({ name: result.name || "", phone: result.phone || "", email: result.email || "", city: result.city || "", education: result.education || "" });
  } catch (err) { return res.json({ name: "", phone: "", email: "", city: "", education: "", error: err.message }); }
});

// ── GENERATE JD endpoint ─────────────────────────────────────────────
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
{"structured":{"about":"2-3 sentences about the role","responsibilities":["r1","r2","r3","r4","r5","r6"],"qualifications":["q1","q2","q3","q4","q5"],"preferred":["p1","p2","p3"],"benefits":["b1","b2","b3","b4"]},"plain":"Full plain text JD here"}`;

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "llama-3.3-70b-versatile", temperature: 0.3, max_tokens: 2000, messages: [{ role: "system", content: "You are a JSON generator. Always respond with valid JSON only." }, { role: "user", content: prompt }] })
    });
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    let jsonString = raw.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const first = jsonString.indexOf("{"); const last = jsonString.lastIndexOf("}");
    if (first === -1 || last === -1) return res.json({ error: "AI did not return valid JSON." });
    jsonString = jsonString.substring(first, last + 1);
    let result;
    try { result = JSON.parse(jsonString); } catch {
      return res.json({ structured: { about: `This is a ${jobTitle} position.`, responsibilities: ["Lead projects", "Collaborate with teams", "Drive innovation", "Mentor junior members", "Report to stakeholders"], qualifications: [`${experience || '3+'} years experience`, `Knowledge of ${skills || 'relevant tools'}`, "Excellent communication", "Bachelor's degree"], preferred: ["Agile experience", "Problem-solving skills", "Fast-paced environment"], benefits: ["Competitive salary", "Health insurance", "Flexible hours", "Learning opportunities"] }, plain: raw });
    }
    return res.json({ structured: result.structured, plain: result.plain });
  } catch (err) { return res.json({ error: err.message }); }
});

app.get("/", (req, res) => res.send("ResuMatch Server Running ✅"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
