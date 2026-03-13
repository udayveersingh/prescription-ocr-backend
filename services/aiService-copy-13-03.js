/**
 * aiService.js
 * Primary: Groq (FREE - no credit card needed)
 * Fallback: OpenAI, Claude, Gemini
 * Set AI_PROVIDER in .env: "groq" | "openai" | "claude" | "gemini"
 */

require("dotenv").config();

const AI_PROVIDER = process.env.AI_PROVIDER || "groq";

// ── Prompt ───────────────────────────────────────────────────
const PRESCRIPTION_PROMPT = `You are a medical prescription reader. Analyze this image of a handwritten or printed prescription and extract all information.

Return ONLY a valid JSON object (no markdown, no explanation, no backticks) with this exact structure:
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

// ── GROQ (FREE - No credit card needed) ─────────────────────
async function analyzeWithGroq(imageBuffer, mimeType) {
  const Groq = require("groq-sdk");
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

  const base64 = imageBuffer.toString("base64");

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    max_tokens: 1500,
    temperature: 0.1,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
            },
          },
          {
            type: "text",
            text: PRESCRIPTION_PROMPT,
          },
        ],
      },
    ],
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

module.exports = { analyzePrescription };