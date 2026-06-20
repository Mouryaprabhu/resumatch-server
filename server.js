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
