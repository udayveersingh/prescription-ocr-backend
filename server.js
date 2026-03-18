const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { processImage } = require("./services/ocrService");
const { analyzePrescription } = require("./services/aiService");
const { validateImage } = require("./middleware/validateImage");
const Prescription = require("./models/Prescription");
const authMiddleware = require("./middleware/authMiddleware");
require("dotenv").config();
const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const familyRoutes = require("./routes/family");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: "*",
  methods: ["GET", "POST","PUT", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json({ limit: "10mb" }));

connectDB();

const UPLOAD_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR);
}

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

app.post(
  "/api/prescription/scan",
  upload.single("image"),
  validateImage,
  async (req, res) => {
    try {
      const imageBuffer = req.file.buffer;
      const mimeType = req.file.mimetype;

      // Step 1: Pre-process image (enhance contrast for better OCR)
      const processedImage = await processImage(imageBuffer);

      // Step 2: Send to AI for reading + structuring
      const result = await analyzePrescription(processedImage, mimeType);

       // 🔹 Save to DB
      const prescription = await Prescription.create({

        user: req.user.id,
        familyMember: req.body.familyMemberId || null,
        patientInfo: result.patientInfo,

        doctorInfo: result.doctorInfo,

        medications: result.medications,

        diagnosis: result.diagnosis,

        additionalNotes: result.additionalNotes,

        confidence: result.confidence,

        warnings: result.warnings,

        meta: {
          processingTime: Date.now() - req.startTime,
          imageSize: req.file.size
        }

      });

      res.json({
        success: true,
        data: result,
        meta: {
          processingTime: Date.now() - req.startTime,
          imageSize: req.file.size,
           savedId: prescription._id
        },
      });
    } catch (err) {
      console.error("Prescription scan error:", err);
      res.status(500).json({
        success: false,
        error: err.message || "Failed to process prescription",
      });
    }
  }
);

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
      .sort({ createdAt: -1 });

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
        const fileName = `scan_${Date.now()}_${index}.jpg`;
        const filePath = path.join(userFolder, fileName);
        fs.writeFileSync(filePath, imageBuffer);

        // Process + analyze
        const processedImage = await processImage(imageBuffer);
        const result = await analyzePrescription(processedImage, mimeType);

        console.log("result from prescription ;;;;;", result);

        return {
          result,
          imagePath: `/uploads/${req.user.id}/${fileName}`,
          imageBuffer,
        };
      })
    );

    // After mergeResults...
    // const merged = mergeResults(scanResults.map(s => s.result));
    // console.log("merge result coming ;;;;;", merged);
    const imagePaths = scanResults.map(s => s.imagePath);

    // Build DB object based on document type
    // const dbData = {
    //   user:          req.user.id,
    //   documentType:  merged.documentType,
    //   imagePaths,
    //   imagePath:     imagePaths[0],
    //   pageCount:     imageList.length,
    //   patientInfo:   merged.patientInfo,
    //   additionalNotes: merged.additionalNotes,
    //   confidence:    merged.confidence,
    //   warnings:      merged.warnings,
    //   meta: { processingTime: Date.now() - req.startTime },
    // };

    // // Add type-specific fields
    // if (merged.documentType === "prescription") {
    //   dbData.doctorInfo  = merged.doctorInfo;
    //   dbData.medications = merged.medications;
    //   dbData.diagnosis   = merged.diagnosis;
    // }

    // if (merged.documentType === "lab_test") {
    //   dbData.labInfo       = merged.labInfo;
    //   dbData.tests         = merged.tests;
    //   dbData.summary       = merged.summary;
    //   dbData.criticalValues = merged.criticalValues;
    // }

    // if (merged.documentType === "radiology") {
    //   dbData.studyInfo       = merged.studyInfo;
    //   dbData.findings        = merged.findings;
    //   dbData.impression      = merged.impression;
    //   dbData.recommendations = merged.recommendations;
    // }

    // const prescription = await Prescription.create(dbData);

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
      meta: { processingTime: Date.now() - req.startTime, pageIndex: index },
    };

    // Add type-specific fields
    if (result.documentType === "prescription") {
      dbData.doctorInfo  = result.doctorInfo;
      dbData.medications = result.medications;
      dbData.diagnosis   = result.diagnosis;
    }

    if (result.documentType === "lab_test") {
      dbData.labInfo        = result.labInfo;
      dbData.tests          = result.tests;
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