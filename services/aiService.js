/**
 * aiService.js
 * Primary: Groq (FREE - no credit card needed)
 * Fallback: OpenAI, Claude, Gemini
 * Set AI_PROVIDER in .env: "groq" | "openai" | "claude" | "gemini"
 */

require("dotenv").config();

const AI_PROVIDER = process.env.AI_PROVIDER || "groq";

// ── Prompt ───────────────────────────────────────────────────
// ── Step 1: Detect document type ────────────────────────────
const DETECT_PROMPT = `Look at this medical document image and identify what type it is.

Return ONLY a valid JSON object (no markdown, no backticks):
{
  "type": "prescription" | "lab_test" | "radiology" | "unknown",
  "confidence": "high" | "medium" | "low",
  "description": "brief one line description of what you see"
}`;

// ── Step 2a: Prescription prompt (existing) ──────────────────
const PRESCRIPTION_PROMPT = `You are a medical prescription reader. Analyze this handwritten or printed prescription and extract all information.

Return ONLY a valid JSON object (no markdown, no backticks):
{
  "patientInfo": {
    "name": "string or null",
    "age": "string or null",
    "gender": "string or null",
    "date": "string or null"
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
      "name": "medication name",
      "genericName": "generic/chemical name if visible or null",
      "dosage": "e.g. 500mg",
      "frequency": "e.g. twice daily / BID",
      "duration": "e.g. 7 days",
      "instructions": "e.g. take after food",
      "quantity": "e.g. 14 tablets or null"
    }
  ],
  "diagnosis": "string or null",
  "additionalNotes": "any other instructions or null",
  "confidence": "high | medium | low",
  "warnings": ["list any unclear or potentially misread items"]
}`;

// ── Step 2b: Lab Test prompt ─────────────────────────────────
const LAB_TEST_PROMPT = `You are a medical lab report reader. Analyze this laboratory test report and extract all test results.

Return ONLY a valid JSON object (no markdown, no backticks):
{
  "documentType": "lab_test",
  "patientInfo": {
    "name": "string or null",
    "age": "string or null",
    "gender": "string or null",
    "sampleDate": "string or null",
    "reportDate": "string or null",
    "patientId": "string or null"
  },
  "labInfo": {
    "labName": "string or null",
    "labAddress": "string or null",
    "contact": "string or null",
    "referredBy": "doctor name who referred or null",
    "reportId": "string or null"
  },
  "tests": [
    {
      "testName": "e.g. Hemoglobin",
      "category": "e.g. Complete Blood Count",
      "value": "actual result value e.g. 13.5",
      "unit": "e.g. g/dL",
      "referenceRange": "e.g. 12.0 - 17.0",
      "status": "normal | high | low | critical",
      "interpretation": "brief note if abnormal or null"
    }
  ],
  "summary": "overall summary of results or null",
  "criticalValues": ["list any critical/panic values found"],
  "additionalNotes": "string or null",
  "confidence": "high | medium | low",
  "warnings": ["list unclear or misread items"]
}

For status field:
- normal: value within reference range
- high: value above reference range  
- low: value below reference range
- critical: dangerously abnormal value needing immediate attention`;

// ── Step 2c: Radiology prompt ────────────────────────────────
const RADIOLOGY_PROMPT = `You are a medical radiology report reader. Analyze this radiology/imaging report.

Return ONLY a valid JSON object (no markdown, no backticks):
{
  "documentType": "radiology",
  "patientInfo": {
    "name": "string or null",
    "age": "string or null",
    "gender": "string or null",
    "date": "string or null"
  },
  "studyInfo": {
    "studyType": "e.g. X-Ray, MRI, CT Scan, Ultrasound",
    "bodyPart": "e.g. Chest, Abdomen, Brain",
    "referredBy": "string or null",
    "radiologist": "string or null",
    "center": "string or null"
  },
  "findings": "detailed findings text or null",
  "impression": "radiologist impression/conclusion or null",
  "recommendations": "string or null",
  "confidence": "high | medium | low",
  "warnings": ["list unclear items"]
}`;

// In aiService.js replace DETECT_PROMPT approach with this:
// const SMART_PROMPT = `You are a medical document reader. First identify what type of document this is, then extract all information accordingly.

// The document could be:
// 1. A PRESCRIPTION (doctor's handwritten or printed medication orders)
// 2. A LAB TEST REPORT (blood tests, urine tests, pathology results with values and reference ranges)
// 3. A RADIOLOGY REPORT (X-ray, MRI, CT scan, ultrasound findings)

// Return ONLY a valid JSON object (no markdown, no backticks).

// If it is a PRESCRIPTION return:
// {
//   "documentType": "prescription",
//   "patientInfo": {
//     "name": "string or null",
//     "age": "string or null",
//     "gender": "string or null",
//     "date": "string or null"
//   },
//   "doctorInfo": {
//     "name": "string or null",
//     "specialization": "string or null",
//     "licenseNumber": "string or null",
//     "clinic": "string or null",
//     "contact": "string or null"
//   },
//   "medications": [
//     {
//       "name": "medication name",
//       "genericName": "generic/chemical name if visible or null",
//       "dosage": "e.g. 500mg",
//       "frequency": "e.g. twice daily / BID",
//       "duration": "e.g. 7 days",
//       "instructions": "e.g. take after food",
//       "quantity": "e.g. 14 tablets or null"
//     }
//   ],
//   "diagnosis": "string or null",
//   "additionalNotes": "any other instructions or null",
//   "confidence": "high | medium | low",
//   "warnings": ["list any unclear or potentially misread items"]
// }
// Be thorough. If handwriting is unclear, include your best guess with a warning. Never hallucinate medication names

// If it is a LAB TEST REPORT return:
// {
//   "documentType": "lab_test",
//   "patientInfo": { "name": null, "age": null, "gender": null, "sampleDate": null, "reportDate": null, "patientId": null },
//   "labInfo": { "labName": null, "labAddress": null, "contact": null, "referredBy": null, "reportId": null },
//   "tests": [{ "testName": "", "category": "", "value": "", "unit": "", "referenceRange": "", "status": "normal | high | low | critical", "interpretation": null }],
//   "summary": null,
//   "criticalValues": [],
//   "additionalNotes": null,
//   "confidence": "high | medium | low",
//   "warnings": []
// }

// If it is a RADIOLOGY REPORT return:
// {
//   "documentType": "radiology",
//   "patientInfo": { "name": null, "age": null, "gender": null, "date": null },
//   "studyInfo": { "studyType": null, "bodyPart": null, "referredBy": null, "radiologist": null, "center": null },
//   "findings": null,
//   "impression": null,
//   "recommendations": null,
//   "confidence": "high | medium | low",
//   "warnings": []
// }

// If unknown return:
// {
//   "documentType": "unknown",
//   "confidence": "low",
//   "warnings": ["Could not identify document type"]
// }`;

// const SMART_PROMPT = `You are an expert medical document reader trained to interpret messy handwritten prescriptions and OCR outputs.

// You will receive:
// 1. A prescription image
// 2. OCR-extracted text (may contain errors, noise, or misspellings)

// Your job:
// - Use the IMAGE as the primary source of truth
// - Use OCR text only as supporting context
// - Correct obvious OCR mistakes (especially medicine names, dosages, numbers)
// - Normalize abbreviations (OD, BD, HS, SOS, BBF, etc.)
// - DO NOT hallucinate or invent medicines
// - If unsure, return null and add a warning

// Common corrections:
// - "50Omg" → "500mg"
// - "Paracitamol" → "Paracetamol"
// - "Eltrox" → "Eltroxin"
// - "Glycomet Iam" → "Glycomet 1g"
// - "Rosuvas sung" → "Rosuvas 5mg"

// Abbreviation meanings:
// - OD = once daily
// - BD = twice daily
// - TDS = three times daily
// - HS = at bedtime
// - BBF = before breakfast
// - SOS = when needed

// Return ONLY a valid JSON object (no markdown, no explanation).

// ----------------------------------------

// If it is a PRESCRIPTION return:

// {
//   "documentType": "prescription",
//   "patientInfo": {
//     "name": "string or null",
//     "age": "string or null",
//     "gender": "string or null",
//     "date": "string or null"
//   },
//   "doctorInfo": {
//     "name": "string or null",
//     "specialization": "string or null",
//     "licenseNumber": "string or null",
//     "clinic": "string or null",
//     "contact": "string or null"
//   },
//   "medications": [
//     {
//       "name": "corrected medication name",
//       "genericName": "if known else null",
//       "dosage": "normalized dosage (e.g. 500mg)",
//       "frequency": "normalized (e.g. once daily)",
//       "duration": "if mentioned else null",
//       "instructions": "clean readable instruction",
//       "quantity": "if mentioned else null"
//     }
//   ],
//   "diagnosis": "cleaned diagnosis or null",
//   "additionalNotes": "cleaned notes or null",
//   "confidence": "high | medium | low",
//   "warnings": [
//     "list unclear or guessed items"
//   ]
// }

// If it is a LAB TEST REPORT return:
// {
//   "documentType": "lab_test",
//   "patientInfo": { "name": null, "age": null, "gender": null, "sampleDate": null, "reportDate": null, "patientId": null },
//   "labInfo": { "labName": null, "labAddress": null, "contact": null, "referredBy": null, "reportId": null },
//   "tests": [{ "testName": "", "category": "", "value": "", "unit": "", "referenceRange": "", "status": "normal | high | low | critical", "interpretation": null }],
//   "summary": null,
//   "criticalValues": [],
//   "additionalNotes": null,
//   "confidence": "high | medium | low",
//   "warnings": []
// }

// If it is a RADIOLOGY REPORT return:
// {
//   "documentType": "radiology",
//   "patientInfo": { "name": null, "age": null, "gender": null, "date": null },
//   "studyInfo": { "studyType": null, "bodyPart": null, "referredBy": null, "radiologist": null, "center": null },
//   "findings": null,
//   "impression": null,
//   "recommendations": null,
//   "confidence": "high | medium | low",
//   "warnings": []
// }

// If uncertain:
// - Prefer null instead of guessing
// - Add warnings explaining uncertainty
// }`;

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
1. A prescription image
2. OCR-extracted text (may contain errors, noise, or misspellings)

Your job:
- Use the IMAGE as the primary source of truth
- Use OCR text only as supporting context
- Correct obvious OCR mistakes (especially medicine names, dosages, numbers)
- Normalize abbreviations (OD, BD, HS, SOS, BBF, etc.)
- DO NOT hallucinate or invent medicines
- If unsure, return null and add a warning

Common corrections:
- "50Omg" → "500mg"
- "Paracitamol" → "Paracetamol"
- "Eltrox" → "Eltroxin"
- "Glycomet Iam" → "Glycomet 1g"
- "Rosuvas sung" → "Rosuvas 5mg"

Return ONLY a valid JSON object (no markdown, no explanation).

----------------------------------------

If it is a PRESCRIPTION return:

{
  "documentType": "prescription",
  "confidence": "high | medium | low",
  "patientInfo": {
    "name": "string or null",
    "age": "string or null",
    "gender": "string or null",
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
  "confidence": "high | medium | low",
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

// ── GROQ (FREE - No credit card needed) ─────────────────────
async function analyzeWithGroq(imageBuffer, mimeType, prompt = PRESCRIPTION_PROMPT) {
  const Groq = require("groq-sdk");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const base64 = imageBuffer.toString("base64");

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    max_tokens: 2000,
    temperature: 0.1,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
        { type: "text", text: prompt },
      ],
    }],
  });
  return parseAIResponse(response.choices[0].message.content);
}

// ── OPENAI GPT-4o ────────────────────────────────────────────
async function analyzeWithOpenAI(imageBuffer, mimeType) {
  const OpenAI = require("openai");
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const base64Image = imageBuffer.toString("base64");
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1500,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PRESCRIPTION_PROMPT },
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Image}` },
          },
        ],
      },
    ],
  });

  return parseAIResponse(response.choices[0].message.content);
}

// ── CLAUDE (Anthropic) ───────────────────────────────────────
async function analyzeWithClaude(imageBuffer, mimeType) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-opus-4-6",
    max_tokens: 1500,
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
          { type: "text", text: PRESCRIPTION_PROMPT },
        ],
      },
    ],
  });

  return parseAIResponse(response.content[0].text);
}

// ── GEMINI ───────────────────────────────────────────────────
async function analyzeWithGemini(imageBuffer, mimeType) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString("base64"),
      mimeType: mimeType,
    },
  };

  const result = await model.generateContent([PRESCRIPTION_PROMPT, imagePart]);
  return parseAIResponse(result.response.text());
}

// ── Response Parser ──────────────────────────────────────────
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
        throw new Error("Could not parse AI response as JSON");
      }
    }
    throw new Error("AI returned non-JSON response: " + text.slice(0, 200));
  }
}

// ── Main Export ──────────────────────────────────────────────
async function analyzePrescription(imageBuffer, mimeType) {
  console.log(`Using AI provider: ${AI_PROVIDER}`);
  switch (AI_PROVIDER) {
    case "openai":
      return analyzeWithOpenAI(imageBuffer, mimeType);
    case "claude":
      return analyzeWithClaude(imageBuffer, mimeType);
    case "gemini":
      return analyzeWithGemini(imageBuffer, mimeType);
    case "groq":
    default:
      return analyzeWithGroq(imageBuffer, mimeType);
  }
}

async function analyzeDocument(imageBuffer, mimeType, ocrText = "") {
  // Single call — detects AND extracts in one shot
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
  console.log(`📄 Document type: ${result.documentType}`);
  return result;
}

// ── Detect document type ─────────────────────────────────────
async function detectDocumentType(imageBuffer, mimeType) {
  try {
    const result = await analyzeWithPrompt(imageBuffer, mimeType, DETECT_PROMPT);
    return result;
  } catch {
    return { type: "prescription", confidence: "low" }; // fallback
  }
}

// ── Generic analyzer with any prompt ────────────────────────
async function analyzeWithPrompt(imageBuffer, mimeType, prompt) {
  switch (AI_PROVIDER) {
    case "openai":  return analyzeWithOpenAI(imageBuffer, mimeType, prompt);
    case "claude":  return analyzeWithClaude(imageBuffer, mimeType, prompt);
    case "gemini":  return analyzeWithGemini(imageBuffer, mimeType, prompt);
    case "groq":
    default:        return analyzeWithGroq(imageBuffer, mimeType, prompt);
  }
}

module.exports = { analyzePrescription: analyzeDocument };