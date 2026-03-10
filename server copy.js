const express = require("express");
const multer = require("multer");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { processImage } = require("./services/ocrService");
const { analyzePrescription } = require("./services/aiService");
const { validateImage } = require("./middleware/validateImage");

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(",") || "*" }));
app.use(express.json({ limit: "10mb" }));

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

// ── Routes ──────────────────────────────────────────────────

/**
 * POST /api/prescription/scan
 * Accepts: multipart/form-data with field "image"
 * Returns: structured prescription data
 */
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

      res.json({
        success: true,
        data: result,
        meta: {
          processingTime: Date.now() - req.startTime,
          imageSize: req.file.size,
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

/**
 * POST /api/prescription/scan-base64
 * Accepts: JSON { image: "base64string", mimeType: "image/jpeg" }
 * Useful for React Native when sending base64 directly
 */
app.post("/api/prescription/scan-base64", async (req, res) => {
  req.startTime = Date.now();
  try {
    const { image, mimeType = "image/jpeg" } = req.body;
    if (!image) return res.status(400).json({ error: "Image is required" });

    const imageBuffer = Buffer.from(image, "base64");
    const processedImage = await processImage(imageBuffer);
    const result = await analyzePrescription(processedImage, mimeType);

    res.json({
      success: true,
      data: result,
      meta: { processingTime: Date.now() - req.startTime },
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