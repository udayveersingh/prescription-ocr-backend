/**
 * aiService.js
 * Primary: Gemini / Groq 
 * Fallback: OpenAI, Claude
 * Set AI_PROVIDER in .env: "groq" | "openai" | "claude" | "gemini"
 */

require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const AI_PROVIDER = process.env.AI_PROVIDER || "groq";

// ── Smart Prompt (Unified Medical Extraction Blueprint) ───────────────────
const SMART_PROMPT = `# ROLE
You are the "Advanced Medical Document Intelligence Engine." Your role is to perform OCR, clinical entity recognition, and structured data extraction from medical documents (Prescriptions, Lab Reports, Radiology) specifically within the Indian healthcare context.

# CLINICAL INFERENCE & CAUTION PROTOCOL (CRITICAL)
Your primary value is your ability to interpret messy, handwritten, or partially obscured text.
1. *Contextual Triangulation:* If a medical term or medication is illegible, do not just return "unclear." Use the surrounding context to make a "Best Guess."
   - Example: If the Doctor's specialty is "Cardiologist" and a medication looks like "At...st..in", map it to "Atorvastatin."
   - Example: If the diagnosis is "Type 2 Diabetes" and a medication starts with "Met...", map it to "Metformin."
2. *The Caution Flag:* Every time you perform a "Best Guess" or mapping for an unclear term, you MUST:
   - Set "isHighRisk": true.
   - Populate the "caution" field with your reasoning (e.g., "Handwriting obscured; inferred Atorvastatin based on Cardiologist profile and dosage").
3. *Safety Guardrail:* If a term is completely illegible and no clinical context (Specialty, Symptoms, or Dosage) exists to support a guess, return "unclear" to avoid dangerous hallucinations.

# TERRITORY & CONVENTIONS
- Focus on Indian Brand Names (e.g., Crocin, Pantocid, Telma, Monocef).
- Recognize Indian dosage shorthand: 1-0-1 (Morning-Afternoon-Night), OD (Once Daily), BD/BID (Twice Daily), TDS/TID (Thrice Daily), HS (At Bedtime), SOS (As needed).
- Recognize AC (Before Food) and PC (After Food).

You will receive:
1. A medical document image
2. OCR-extracted text (may contain errors, noise, or misspellings)

Your job:
- Use the IMAGE as the primary source of truth
- Use OCR text only as supporting context
- Correct obvious OCR mistakes (especially medicine names, dosages, numbers)
- Normalize abbreviations (OD, BD, HS, SOS, BBF, etc.)
- DO NOT hallucinate or invent medicines
- If unsure, return null and add a warning


Return ONLY a valid, minified JSON object (no markdown wrappers, no backticks, no indentation, no conversational text). Start directly with { and end directly with }.

----------------------------------------

If it is a PRESCRIPTION return:
{
  "documentType": "prescription",
  "confidence": "high | medium | low",
  "patientInfo": {
    "name": "string or null",
    "age": "string or null",
    "gender": "string or null",
    "weight":"string or null",
    "blood_group":"string or null",
    "date": "ISO-8601 date string"
  },
  "doctorInfo": {
    "name": "string or null",
    "specialization": "string or null",
    "licenseNumber": "string or null",
    "clinic": "string or null",
    "contact": "string or null"
  },
  "medications": [
    {
      "name": "Brand Name or Inferred Name",
      "genericName": "Chemical/Molecule name if known else null",
      "dosage": "normalized dosage (e.g. 500mg)",
      "form": "Tablet | Syrup | Ointment | Injection",
      "frequency": "normalized (e.g. once daily)",
      "timing": "e.g., After Food / PC",
      "duration": "e.g., 5 days if mentioned else null",
      "instructions": "clean readable instruction",
      "quantity": "if mentioned else null",
      "isHighRisk": boolean, 
      "caution": "Reason for inference or null"
    }
  ],
  "diagnosis": "cleaned diagnosis or null",
  "additionalNotes": "cleaned notes or null",
  "symptoms": ["list of reported complaints"],
  "advice": "lifestyle or dietary instructions",
  "followUpDate": "ISO-8601 date string or null",
  "warnings": [
    "list unclear or guessed items"
  ]
}

If it is a LAB TEST REPORT return:
{
  "documentType": "lab_test",
  "patientInfo": { "name": null, "age": null, "gender": null, "sampleDate": null, "reportDate": null, "patientId": null },
  "labInfo": { "labName": null, "labAddress": null, "contact": null, "referredBy": null, "reportId": null },
  "tests": [{ "testName": "", "category": "", "value": "", "unit": "", "referenceRange": "", "status": "normal | high | low | critical", "interpretation": null }],
  "summary": null,
  "criticalValues": [],
  "additionalNotes": null,
  "confidence": "high | medium | low",
  "warnings": []
}

If it is a RADIOLOGY REPORT return:
{
  "documentType": "radiology",
  "patientInfo": { "name": null, "age": null, "gender": null, "date": null },
  "studyInfo": { "studyType": null, "bodyPart": null, "referredBy": null, "radiologist": null, "center": null },
  "findings": null,
  "impression": null,
  "recommendations": null,
  "confidence": "high | medium | low",
  "warnings": []
}

If uncertain:
- Prefer null instead of guessing
- Add warnings explaining uncertainty
}`;

// ── GEMINI MULTIMODAL ANALYZER ─────────────────────────────
async function analyzeWithGemini(imageBuffer, mimeType, prompt) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString("base64"),
      mimeType: mimeType,
    },
  };

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [prompt, imagePart],
    config: {
      temperature: 0.1,
      maxOutputTokens: 10000,  // --token
      responseMimeType: "application/json",
      systemInstruction: "You are a medical document analyzer. You MUST respond with ONLY a single valid JSON object matching the requested schema. No explanations, no markdown block wrappers.",
    }
  });

  return parseAIResponse(response.text);
}

// ── GROQ ENGINE ────────────────────────────────────────────
async function analyzeWithGroq(imageBuffer, mimeType, prompt) {
  const Groq = require("groq-sdk");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const base64 = imageBuffer.toString("base64");

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    max_tokens: 2500,
    temperature: 0.1,
    messages: [
      {
        role: "system",
        content: "You are a medical document analyzer. You MUST respond with ONLY valid JSON. No explanations, no markdown.",
      },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
          { type: "text", text: prompt },
        ],
      }
    ],
  });

  return parseAIResponse(response.choices[0].message.content);
}

// ── OPENAI GPT-4o ────────────────────────────────────────────
async function analyzeWithOpenAI(imageBuffer, mimeType, prompt) {
  const OpenAI = require("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const base64Image = imageBuffer.toString("base64");

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 2500,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You are a medical document analyzer. Extract all requested data structural points into a single JSON response.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        ],
      },
    ],
  });

  return parseAIResponse(response.choices[0].message.content);
}

// ── CLAUDE (Anthropic) ───────────────────────────────────────
async function analyzeWithClaude(imageBuffer, mimeType, prompt) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 2500,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: imageBuffer.toString("base64"),
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  return parseAIResponse(response.content[0].text);
}

// ── GEMINI TEXT-ONLY ANALYZER (for PDFs) ───────────────────
async function analyzeTextOnly(text) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const fullPrompt = `Analyze this medical document and extract all information into JSON format.

${SMART_PROMPT}

DOCUMENT TEXT:
"""
${text}
"""

Respond with ONLY the JSON object starting with { and ending with }.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: fullPrompt,
    config: {
      temperature: 0.1,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      systemInstruction: "You are a medical document analyzer. Respond with ONLY valid JSON.",
    }
  });

  return parseAIResponse(response.text);
}

// ── Route Interceptor Switch-Gating ─────────────────────────
async function analyzeWithPrompt(imageBuffer, mimeType, prompt) {
  switch (AI_PROVIDER.toLowerCase()) {
    case "openai":  return analyzeWithOpenAI(imageBuffer, mimeType, prompt);
    case "claude":  return analyzeWithClaude(imageBuffer, mimeType, prompt);
    case "gemini":  return analyzeWithGemini(imageBuffer, mimeType, prompt);
    case "groq":
    default:        return analyzeWithGroq(imageBuffer, mimeType, prompt);
  }
}

async function analyzeDocument(imageBuffer, mimeType, ocrText = "") {
  console.log(`Using AI provider: ${AI_PROVIDER}`);
  
  const enhancedPrompt = `
${SMART_PROMPT}

-------------------------
OCR TEXT (may contain errors):
"""
${ocrText}
"""
`;

  const result = await analyzeWithPrompt(imageBuffer, mimeType, enhancedPrompt);
  console.log(`📄 Document type identified: ${result.documentType}`);
  return result;
}

// ── Response Parser Sandbox ─────────────────────────────────
function parseAIResponse(text) {
  try {
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {
        const matches = text.match(/\{[\s\S]*?\}/g);
        if (matches) {
          for (const m of matches.sort((a, b) => b.length - a.length)) {
            try { return JSON.parse(m); } catch {}
          }
        }
      }
    }
    throw new Error("AI returned non-JSON response: " + text.slice(0, 200));
  }
}

module.exports = { 
  analyzePrescription: analyzeDocument, 
  analyzeTextOnly 
};