const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { processImage, extractTextFromImage } = require("./services/ocrService");
const { analyzePrescription } = require("./services/aiService");
const { validateImage } = require("./middleware/validateImage");
const Prescription = require("./models/Prescription");
const authMiddleware = require("./middleware/authMiddleware");
require("dotenv").config();
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const familyRoutes = require("./routes/family");
const healthqrRoutes = require("./routes/healthqr");
const fs = require("fs");
const path = require("path");
const { parsePatientDateString } = require("./utils/utils");
const HealthQR = require("./models/HealthQR");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: "*",
  methods: ["GET", "POST","PUT", "OPTIONS","DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "10mb" }));

connectDB();

const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

app.set('trust proxy', 1);

// Rate limiting - important for free AI APIs
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60,
  message: { error: "Too many requests, please try again later." },
});
app.use("/api/", limiter);

// Multer setup - memory storage (no disk write needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, WebP, and HEIC images are allowed"));
    }
  },
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
// ── Routes ──────────────────────────────────────────────────

/**
 * POST /api/prescription/scan
 * Accepts: multipart/form-data with field "image"
 * Returns: structured prescription data
 */

app.use("/api/auth", authRoutes);

// app.post(
//   "/api/prescription/scan",
//   upload.single("image"),
//   validateImage,
//   async (req, res) => {
//     try {
//       const imageBuffer = req.file.buffer;
//       const mimeType = req.file.mimetype;

//       // Step 1: Pre-process image (enhance contrast for better OCR)
//       const processedImage = await processImage(imageBuffer);

//       // Step 2: Send to AI for reading + structuring
//       const result = await analyzePrescription(processedImage, mimeType);

//        // 🔹 Save to DB
//       const prescription = await Prescription.create({

//         user: req.user.id,
//         familyMember: req.body.familyMemberId || null,
//         patientInfo: result.patientInfo,

//         doctorInfo: result.doctorInfo,

//         medications: result.medications,

//         diagnosis: result.diagnosis,

//         additionalNotes: result.additionalNotes,

//         confidence: result.confidence,

//         warnings: result.warnings,

//         meta: {
//           processingTime: Date.now() - req.startTime,
//           imageSize: req.file.size
//         }

//       });

//       res.json({
//         success: true,
//         data: result,
//         meta: {
//           processingTime: Date.now() - req.startTime,
//           imageSize: req.file.size,
//            savedId: prescription._id
//         },
//       });
//     } catch (err) {
//       console.error("Prescription scan error:", err);
//       res.status(500).json({
//         success: false,
//         error: err.message || "Failed to process prescription",
//       });
//     }
//   }
// );

app.get("/api/prescription/history", authMiddleware, async (req, res) => {

  try {
    const query = { user: req.user.id };

    if (req.query.familyMemberId) {
      query.familyMember = req.query.familyMemberId;
    }

    // const prescriptions = await Prescription
    //   .find({ user: req.user.id })
    //   .sort({ createdAt: -1 });

    const prescriptions = await Prescription
      .find(query)
      // .sort({ createdAt: -1 });
      .sort({ patientParsedDate: -1 });

    res.json({
      success: true,
      data: prescriptions
    });

  } catch (err) {

    res.status(500).json({
      error: "Failed to fetch history"
    });

  }

});

app.delete("/api/prescription/:id", authMiddleware, async (req, res) => {
  try {
    const prescription = await Prescription.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id, // ← ensures user can only delete their own
    });

    if (!prescription) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json({ success: true, message: "Record deleted" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete record" });
  }
});

app.patch("/api/prescription/:id/medication/:medIndex", authMiddleware, async (req, res) => {
  try {
    const { id, medIndex } = req.params;
    const { name } = req.body;

    const prescription = await Prescription.findOne({ _id: id, user: req.user.id });
    if (!prescription) return res.status(404).json({ error: "Not found" });

    prescription.medications[medIndex].name = name;
    await prescription.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update" });
  }
});

app.get('/api/update-prescriptions', async(req, res) =>{
  try {
    const prescriptions = await Prescription.find({ patientParsedDate: null });
    for (const doc of prescriptions) {
      // doc.patientParsedDate = parsePatientDateString(doc.patientInfo?.date);
      const parsed = parsePatientDateString(doc.patientInfo?.date, doc._id);
      doc.patientParsedDate = parsed;
      await doc.save();
    }
    console.log(`Migrated ${prescriptions.length} records`);

    return res.json({status: "date updated"});
  } catch (err) {
    console.log("error while update prescription ;;;", err);
    res.status(500).json({ success: false, error: err.message });
  }
})

app.get("/backup", (req, res) => {
  const fs = require("fs");
  const archiver = require("archiver");

  const archive = archiver("zip");
  res.attachment("backup.zip");

  archive.pipe(res);
  archive.directory("uploads/", false);
  archive.finalize();
});

// In server.js — add this route
app.put("/api/prescription/assign-family", authMiddleware, async (req, res) => {
  try {
    const { savedIds, familyMemberId } = req.body;
    await Prescription.updateMany(
      { _id: { $in: savedIds }, user: req.user.id },
      { familyMember: familyMemberId || null }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.use("/api/family", familyRoutes);
app.use("/api/healthqr", healthqrRoutes);

/**
 * POST /api/prescription/scan-base64
 * Accepts: JSON { image: "base64string", mimeType: "image/jpeg" }
 * Useful for React Native when sending base64 directly
 */

function mergeResults(results) {
  // Get document type from first result
  const documentType = results[0].documentType || "prescription";

  // ── Handle lab_test merging ──────────────────────────────
  if (documentType === "lab_test") {
    const patientInfo = results.find(r => r.patientInfo?.name)?.patientInfo
      || results[0].patientInfo;

    const labInfo = results.find(r => r.labInfo?.labName)?.labInfo
      || results[0].labInfo;

    // Merge all tests, remove duplicates by testName
    const allTests = results.flatMap(r => r.tests || []);
    const uniqueTests = allTests.filter(
      (test, index, self) =>
        index === self.findIndex(t =>
          t.testName?.toLowerCase() === test.testName?.toLowerCase()
        )
    );

    const criticalValues = [...new Set(results.flatMap(r => r.criticalValues || []))];
    const warnings = [...new Set(results.flatMap(r => r.warnings || []))];
    const summaries = results.map(r => r.summary).filter(Boolean).join(" | ");

    return {
      documentType: "lab_test",
      patientInfo,
      labInfo,
      tests: uniqueTests,
      summary: summaries || null,
      criticalValues,
      additionalNotes: results.map(r => r.additionalNotes).filter(Boolean).join(" | ") || null,
      confidence: getLowestConfidence(results),
      warnings,
    };
  }

  // ── Handle radiology merging ─────────────────────────────
  if (documentType === "radiology") {
    return {
      documentType: "radiology",
      patientInfo: results.find(r => r.patientInfo?.name)?.patientInfo || results[0].patientInfo,
      studyInfo:   results.find(r => r.studyInfo?.studyType)?.studyInfo || results[0].studyInfo,
      findings:    results.map(r => r.findings).filter(Boolean).join("\n\n") || null,
      impression:  results.map(r => r.impression).filter(Boolean).join("\n\n") || null,
      recommendations: results.map(r => r.recommendations).filter(Boolean).join(" | ") || null,
      confidence:  getLowestConfidence(results),
      warnings:    [...new Set(results.flatMap(r => r.warnings || []))],
    };
  }

  // Helper
function getLowestConfidence(results) {
  const order = { high: 3, medium: 2, low: 1 };
  return results.reduce((lowest, r) => {
    return order[r.confidence] < order[lowest] ? r.confidence : lowest;
  }, "high");
}

  // ── Handle prescription merging (original) ───────────────
  const patientInfo = results.find(r => r.patientInfo?.name)?.patientInfo
    || results[0].patientInfo;

  const doctorInfo = results.find(r => r.doctorInfo?.name)?.doctorInfo
    || results[0].doctorInfo;

  const allMedications = results.flatMap(r => r.medications || []);
  const uniqueMedications = allMedications.filter(
    (med, index, self) =>
      index === self.findIndex(m =>
        m.name?.toLowerCase() === med.name?.toLowerCase()
      )
  );

  return {
    documentType: "prescription",
    patientInfo,
    doctorInfo,
    medications: uniqueMedications,
    diagnosis: results.map(r => r.diagnosis).filter(Boolean).join(", ") || null,
    additionalNotes: results.map(r => r.additionalNotes).filter(Boolean).join(" | ") || null,
    confidence: getLowestConfidence(results),
    warnings: [...new Set(results.flatMap(r => r.warnings || []))],
  };
}

const VALID_STATUSES = ["normal", "high", "low", "critical"];
function sanitizeTestStatus(status) {
  if (!status) return "normal";
  const s = status.toLowerCase().trim();
  if (VALID_STATUSES.includes(s)) return s;
  // Map common AI responses to valid values
  const map = {
    "not applicable": "normal",
    "n/a":            "normal",
    "na":             "normal",
    "within range":   "normal",
    "in range":       "normal",
    "elevated":       "high",
    "above normal":   "high",
    "below normal":   "low",
    "decreased":      "low",
    "abnormal":       "high",
    "borderline":     "high",
    "positive":       "high",   // for culture/sensitivity tests
    "negative":       "normal",
    "reactive":       "high",
    "non-reactive":   "normal",
  };
  return map[s] || "normal"; // fallback to "normal" if unknown
}

const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    cloudinary.uploader.upload_stream(
      {
        folder: "prescriptions",
        transformation: [
          { quality: "auto", fetch_format: "auto" }
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    ).end(buffer);
  });
};

app.get("/api/prescription/summary", authMiddleware, async (req, res) => {
  try {
    const query = { user: req.user.id };
    if (req.query.familyMemberId) query.familyMember = req.query.familyMemberId;

    const records = await Prescription.find(query).sort({ createdAt: -1 });

    const medications = [];
    const tests       = [];
    const doctors     = [];
    const diagnoses   = [];
    const warnings    = [];

    records.forEach(r => {
      if (r.documentType === "prescription") {
        r.medications?.forEach(m => {
          if (m.name) medications.push({ name: m.name, dosage: m.dosage, frequency: m.frequency, duration: m.duration, date: r.createdAt });
        });
        if (r.doctorInfo?.name) {
          const exists = doctors.find(d => d.name === r.doctorInfo.name);
          if (!exists) doctors.push({ name: r.doctorInfo.name, specialization: r.doctorInfo.specialization, clinic: r.doctorInfo.clinic, lastVisit: r.createdAt });
        }
        if (r.diagnosis) diagnoses.push({ text: r.diagnosis, date: r.createdAt });
        r.symptoms?.forEach(s => { if (s) diagnoses.push({ text: s, date: r.createdAt, type: "symptom" }); });
      }
      if (r.documentType === "lab_test") {
        r.tests?.forEach(t => {
          tests.push({ testName: t.testName, value: t.value, unit: t.unit, status: t.status, referenceRange: t.referenceRange, date: r.createdAt });
        });
        r.criticalValues?.forEach(v => warnings.push({ text: v, date: r.createdAt }));
      }
      r.warnings?.forEach(w => warnings.push({ text: w, date: r.createdAt }));
    });

    // ── Groq instead of Anthropic ──
    const Groq = require("groq-sdk");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const response = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      max_tokens: 300,
      temperature: 0.3,
      messages: [{
        role: "user",
        content: `You are a medical summary assistant. Based on the following patient data, write a clear, friendly health summary in 3-4 sentences covering overall health status, key concerns, and any patterns you notice. Do not give medical advice. Keep it simple for a non-medical person to understand.

Patient Data:
- Total Records: ${records.length}
- Medications: ${medications.map(m => m.name).join(", ") || "None"}
- Diagnoses: ${diagnoses.filter(d => !d.type).map(d => d.text).join(", ") || "None"}
- Abnormal Tests: ${tests.filter(t => t.status !== "normal").map(t => `${t.testName} (${t.status})`).join(", ") || "None"}
- Warnings: ${warnings.map(w => w.text).join(", ") || "None"}
- Doctors Visited: ${doctors.map(d => d.name).join(", ") || "None"}

Write the summary now:`,
      }],
    });

    const aiSummary = response.choices[0].message.content || "Summary unavailable.";

    res.json({
      success: true,
      data: { aiSummary, medications, tests, doctors, diagnoses, warnings, totalRecords: records.length }
    });

  } catch (err) {
    console.error("Summary error:", err);
    res.status(500).json({ error: "Failed to generate summary" });
  }
});


app.post("/api/prescription/second-opinion", authMiddleware, async (req, res) => {
  try {
    const { question, familyMemberId, chatHistory = [] } = req.body;

    // ── Fetch all records for context ──
    const query = { user: req.user.id };
    if (familyMemberId) query.familyMember = familyMemberId;
    const records = await Prescription.find(query).sort({ createdAt: -1 });

    // ── Build medical context from records ──
    const context = records.map(r => {
      if (r.documentType === "prescription") {
        return `
Prescription (${new Date(r.createdAt).toLocaleDateString("en-IN")}):
- Patient: ${r.patientInfo?.name || "Unknown"}
- Doctor: ${r.doctorInfo?.name || "Unknown"} (${r.doctorInfo?.specialization || ""})
- Diagnosis: ${r.diagnosis || "Not mentioned"}
- Symptoms: ${r.symptoms?.join(", ") || "None"}
- Medications: ${r.medications?.map(m => `${m.name} ${m.dosage || ""} ${m.frequency || ""}`).join(", ") || "None"}
- Notes: ${r.additionalNotes || "None"}
        `.trim();
      }
      if (r.documentType === "lab_test") {
        return `
Lab Test (${new Date(r.createdAt).toLocaleDateString("en-IN")}):
- Tests: ${r.tests?.map(t => `${t.testName}: ${t.value} ${t.unit} (${t.status})`).join(", ") || "None"}
- Critical Values: ${r.criticalValues?.join(", ") || "None"}
- Summary: ${r.summary || "None"}
        `.trim();
      }
      if (r.documentType === "radiology") {
        return `
Radiology (${new Date(r.createdAt).toLocaleDateString("en-IN")}):
- Study: ${r.studyInfo?.studyType} - ${r.studyInfo?.bodyPart}
- Findings: ${r.findings || "None"}
- Impression: ${r.impression || "None"}
        `.trim();
      }
    }).filter(Boolean).join("\n\n");

    const systemPrompt = `You are a helpful medical assistant. You answer questions based ONLY on the patient's medical records provided below. 
Always be clear, friendly, and easy to understand for a non-medical person.
Never diagnose or prescribe. Always end with "Please consult your doctor for medical advice."
If the answer is not in the records, say "I don't see this in your records."

PATIENT MEDICAL RECORDS:
${context || "No records found."}`;

    // ── Build messages with chat history ──
    const Groq = require("groq-sdk");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const messages = [
      ...chatHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: question },
    ];

    const response = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      max_tokens: 500,
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    });

    const answer = response.choices[0].message.content;

    res.json({ success: true, answer });
  } catch (err) {
    console.error("Second opinion error:", err);
    res.status(500).json({ error: "Failed to get second opinion" });
  }
});

app.post("/api/prescription/scan-base64", authMiddleware, async (req, res) => {
  req.startTime = Date.now();
  try {
    // Support both single image and array of images
    const { image, images, mimeType = "image/jpeg" } = req.body;

    // Normalize to array
    const imageList = images || (image ? [image] : null);
    if (!imageList || imageList.length === 0) {
      return res.status(400).json({ error: "At least one image is required" });
    }
    if (imageList.length > 5) {
      return res.status(400).json({ error: "Maximum 5 images allowed per scan" });
    }

    const userFolder = path.join(UPLOAD_DIR, req.user.id.toString());
    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }

    // Process all images in parallel
    const scanResults = await Promise.all(
      imageList.map(async (base64Image, index) => {
        const imageBuffer = Buffer.from(base64Image, "base64");

        // Save file
        // const fileName = `scan_${Date.now()}_${index}.jpg`;
        // const filePath = path.join(userFolder, fileName);
        // fs.writeFileSync(filePath, imageBuffer);
        const uploadResult = await uploadToCloudinary(imageBuffer);
        const imageUrl = uploadResult.secure_url;

        // Process + analyze
        const processedImage = await processImage(imageBuffer);
        // console.log("process image ;;;;;;", processedImage);

        // Step 2: OCR (NEW)
      const { text: ocrText, confidence: ocrConfidence } =
        await extractTextFromImage(processedImage);

      console.log("🧾 OCR TEXT:", ocrText);

      // return res.send(ocrText);

        // return;
        const result = await analyzePrescription(processedImage, mimeType,  ocrText);

        // console.log("result from prescription ;;;;;", result);

        return {
          result,
          // imagePath: `/uploads/${req.user.id}/${fileName}`,
          imagePath: imageUrl,
          imageBuffer,
        };
      })
    );

    // After mergeResults...
    // const merged = mergeResults(scanResults.map(s => s.result));
    // console.log("merge result coming ;;;;;", merged);
    const imagePaths = scanResults.map(s => s.imagePath);

    // Save one record per page
const savedRecords = await Promise.all(
  scanResults.map(async (scanResult, index) => {
    const result = scanResult.result;

    const dbData = {
      user:            req.user.id,
      documentType:    result.documentType,
      imagePaths:      [scanResult.imagePath],
      imagePath:       scanResult.imagePath,
      pageCount:       1,
      patientInfo:     result.patientInfo,
      additionalNotes: result.additionalNotes,
      confidence:      result.confidence,
      warnings:        result.warnings,
      advice:        result.advice,
      meta: { processingTime: Date.now() - req.startTime, pageIndex: index },
      patientParsedDate: parsePatientDateString(result.patientInfo?.date, "new-scan"), // ← add this
    };

    // Add type-specific fields
    if (result.documentType === "prescription") {
      dbData.doctorInfo  = result.doctorInfo;
      dbData.medications = result.medications;
      dbData.diagnosis   = result.diagnosis;
      dbData.symptoms   = result.symptoms;
      dbData.followUpDate   = result.followUpDate;
    }

    if (result.documentType === "lab_test") {
      dbData.labInfo        = result.labInfo;
      // dbData.tests          = result.tests;
      dbData.tests          = (result.tests || []).map(test => ({
        ...test,
        status: sanitizeTestStatus(test.status),   // ← sanitized
      }));
      dbData.summary        = result.summary;
      dbData.criticalValues = result.criticalValues;
    }

    if (result.documentType === "radiology") {
      dbData.studyInfo       = result.studyInfo;
      dbData.findings        = result.findings;
      dbData.impression      = result.impression;
      dbData.recommendations = result.recommendations;
    }

    return Prescription.create(dbData);
  })
);

const merged = mergeResults(scanResults.map(s => s.result));

    res.json({
      success: true,
      data: merged,
      pageCount: imageList.length,
      meta: { processingTime: Date.now() - req.startTime },
      savedIds:  savedRecords.map(r => r._id), 
       pageResults: scanResults.map(s => s.result),
      // savedId: prescription._id
    });

  } catch (err) {
    console.error("Scan error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", version: "1.0.0" }));

// Timing middleware
app.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
module.exports = app;