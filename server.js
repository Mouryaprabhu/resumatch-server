const express = require("express");
const cors = require("cors");
const multer = require("multer");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ── OCR using OCR.space API ──────────────────────────────────────────
async function ocrExtract(fileBuffer, fileName) {
  try {
    const ocrKey = process.env.OCR_SPACE_API_KEY;
    if (!ocrKey) return '';

    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, { filename: fileName, contentType: 'application/pdf' });
    form.append('apikey', ocrKey);
    form.append('language', 'eng');
    form.append('isOverlayRequired', 'false');
    form.append('detectOrientation', 'true');
    form.append('scale', 'true');
    form.append('OCREngine', '2');

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: form.getHeaders(),
      body: form
    });

    const data = await response.json();
    if (data.ParsedResults && data.ParsedResults.length > 0) {
      const text = data.ParsedResults.map(r => r.ParsedText).join(' ').replace(/\s+/g, ' ').trim();
      console.log(`OCR extracted ${text.length} characters`);
      return text;
    }
    return '';
  } catch(e) {
    console.log('OCR error:', e.message);
    return '';
  }
}

// ── Extract text from uploaded file ─────────────────────────────────
async function extractTextFromFile(file) {
  const ext = file.originalname.split('.').pop().toLowerCase();
  console.log(`Extracting: ${file.originalname} (${ext}), size: ${file.buffer.length} bytes`);

  if (ext === 'pdf') {
    try {
      // First try normal PDF text extraction
      const data = await pdfParse(file.buffer);
      const text = data.text.replace(/\s+/g, ' ').trim();
      console.log(`PDF text extracted: ${text.length} characters`);

      // If text is too short, it's a scanned PDF — use OCR
      if (text.length < 100) {
        console.log('PDF text too short, trying OCR...');
        const ocrText = await ocrExtract(file.buffer, file.originalname);
        return ocrText;
      }
      return text;
    } catch(e) {
      console.log('PDF parse failed, trying OCR:', e.message);
      return await ocrExtract(file.buffer, file.originalname);
    }
  } else if (ext === 'docx') {
    try {
      const result = await mammoth.extractRawText({ buffer: file.buffer });
      const text = result.value.replace(/\s+/g, ' ').trim();
      console.log(`DOCX extracted: ${text.length} characters`);
      return text;
    } catch(e) {
      console.log('DOCX error:', e.message);
      return '';
    }
  } else if (ext === 'doc') {
    try {
      let text = '', chunk = '';
      const bytes = new Uint8Array(file.buffer);
      for (let i = 0; i < bytes.length; i++) {
        const c = bytes[i];
        if (c >= 32 && c < 127) chunk += String.fromCharCode(c);
        else { if (chunk.length > 4) text += chunk + ' '; chunk = ''; }
      }
      return text.replace(/\s+/g, ' ').trim();
    } catch(e) { return ''; }
  } else {
    try {
      return file.buffer.toString('utf-8').replace(/\s+/g, ' ').trim();
    } catch(e) { return ''; }
  }
}

// ── MATCH endpoint ───────────────────────────────────────────────────
app.post("/match", upload.fields([{ name: 'resumeFile', maxCount: 1 }]), async (req, res) => {
  const apiKey = process.env.GROQ_API_KEY;
  let jd = req.body.jd || '';
  let resume = req.body.resume || '';

  if (req.files && req.files.resumeFile) {
    resume = await extractTextFromFile(req.files.resumeFile[0]);
  }

  if (!jd || !resume) return res.json({ score: 0, relevant: false, verdict: "Missing Input", summary: "Please provide both Job Description and Resume." });
  if (!apiKey) return res.json({ score: 0, relevant: false, verdict: "Server Error", summary: "GROQ_API_KEY is missing." });
  if (resume.length < 50) return res.json({ score: 0, relevant: false, verdict: "Could not read file", summary: "Could not extract text from the uploaded file. Please paste resume text manually." });

  try {
    const prompt = `You are an expert ATS evaluator. Compare the Job Description and Resume below.
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

  if (req.files && req.files.resumeFile) {
    resume = await extractTextFromFile(req.files.resumeFile[0]);
  }

  console.log(`Extract - resume text length: ${resume.length}`);

  if (!resume || resume.length < 30) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "Could not read file. File may be image-based or corrupted." });
  if (!apiKey) return res.json({ name: "", phone: "", email: "", city: "", education: "", error: "GROQ_API_KEY is missing." });

  try {
    const prompt = `You are a resume data extraction expert. Extract ONLY these 5 fields from the resume text below.
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
    const prompt = `You are an expert HR professional. Generate a job description and return ONLY a JSON object.
Job Details:
- Title: ${jobTitle}
- Department: ${department || 'General'}
- Experience: ${experience || 'Not specified'}
- Skills: ${skills || 'Not specified'}
- Location: ${location || 'Not specified'}
- Type: ${employmentType || 'Full Time'}
Return this exact JSON:
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
