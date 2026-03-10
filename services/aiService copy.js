/**
 * aiService.js
 * Supports: Google Gemini (FREE tier), OpenAI GPT-4o, Anthropic Claude
 * Set AI_PROVIDER in .env: "gemini" | "openai" | "claude"
 * Default: gemini (free, best for medical image reading)
 */

require("dotenv").config();

const AI_PROVIDER = process.env.AI_PROVIDER || "gemini";

// ── Prompt (same for all providers) ─────────────────────────
const PRESCRIPTION_PROMPT = `You are a medical prescription reader. Analyze this image of a handwritten or printed prescription and extract all information.

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
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
}

Be thorough. If handwriting is unclear, include your best guess with a warning. Never hallucinate medication names.`;

// ── GEMINI (Google AI - FREE tier available) ─────────────────
async function analyzeWithGemini(imageBuffer, mimeType) {
  const { GoogleGenerativeAI } = require("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // gemini-1.5-flash is FREE and handles images well
  // const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  // const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
  // const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const imagePart = {
    inlineData: {
      data: imageBuffer.toString("base64"),
      mimeType: mimeType,
    },
  };

  const result = await model.generateContent([PRESCRIPTION_PROMPT, imagePart]);
  const text = result.response.text();
  return parseAIResponse(text);
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

// ── Response Parser ──────────────────────────────────────────
function parseAIResponse(text) {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/```json\n?|\n?```/g, "").trim();
    return JSON.parse(cleaned);
  } catch (e) {
    // Try to extract JSON object from text
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("AI returned non-JSON response: " + text.slice(0, 200));
  }
}

// ── Main Export ──────────────────────────────────────────────
async function analyzePrescription(imageBuffer, mimeType) {
  switch (AI_PROVIDER) {
    case "openai":
      return analyzeWithOpenAI(imageBuffer, mimeType);
    case "claude":
      return analyzeWithClaude(imageBuffer, mimeType);
    case "gemini":
    default:
      return analyzeWithGemini(imageBuffer, mimeType);
  }
}

module.exports = { analyzePrescription };