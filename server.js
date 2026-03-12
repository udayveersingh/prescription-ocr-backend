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
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
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
  max: 20,
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

    const prescriptions = await Prescription
      .find({ user: req.user.id })
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

/**
 * POST /api/prescription/scan-base64
 * Accepts: JSON { image: "base64string", mimeType: "image/jpeg" }
 * Useful for React Native when sending base64 directly
 */
app.post("/api/prescription/scan-base64", authMiddleware, async (req, res) => {
  req.startTime = Date.now();
  try {
    const { image, mimeType = "image/jpeg" } = req.body;
    if (!image) return res.status(400).json({ error: "Image is required" });

    const imageBuffer = Buffer.from(image, "base64");

    // create user folder
    const userFolder = path.join(UPLOAD_DIR, req.user.id.toString());

    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }

    // create file name
    const fileName = `scan_${Date.now()}.jpg`;
    const filePath = path.join(userFolder, fileName);

    // save file
    fs.writeFileSync(filePath, imageBuffer);

    const processedImage = await processImage(imageBuffer);
    const result = await analyzePrescription(processedImage, mimeType);

    // 🔹 Save to DB
    const prescription = await Prescription.create({
      user: req.user.id,
      imagePath: `/uploads/${req.user.id}/${fileName}`,   
      patientInfo: result.patientInfo,
      doctorInfo: result.doctorInfo,
      medications: result.medications,
      diagnosis: result.diagnosis,
      additionalNotes: result.additionalNotes,
      confidence: result.confidence,
      warnings: result.warnings,
      meta: {
        processingTime: Date.now() - req.startTime,
      }
    });

    res.json({
      success: true,
      data: result,
      meta: { processingTime: Date.now() - req.startTime },
      savedId: prescription._id
    });
  } catch (err) {
    console.error("Base64 scan error:", err);
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