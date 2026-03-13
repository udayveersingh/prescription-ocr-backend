const mongoose = require("mongoose");

// ── Prescription sub-schemas ─────────────────────────────────
const medicationSchema = new mongoose.Schema({
  name:         String,
  genericName:  String,
  dosage:       String,
  frequency:    String,
  duration:     String,
  instructions: String,
  quantity:     String,
});

// ── Lab Test sub-schemas ─────────────────────────────────────
const testResultSchema = new mongoose.Schema({
  testName:       String,
  category:       String,
  value:          String,
  unit:           String,
  referenceRange: String,
  status: {
    type: String,
    enum: ["normal", "high", "low", "critical"],
    default: "normal",
  },
  interpretation: String,
});

// ── Main Schema ──────────────────────────────────────────────
const prescriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ── Document type ──────────────────────────────────────
    documentType: {
      type: String,
      enum: ["prescription", "lab_test", "radiology", "unknown"],
      default: "prescription",
    },

    // ── Images ────────────────────────────────────────────
    imagePath:  String,        // first image (backward compat)
    imagePaths: [String],      // all pages
    pageCount:  { type: Number, default: 1 },

    // ── Common patient info (all types) ───────────────────
    patientInfo: {
      name:       String,
      age:        String,
      gender:     String,
      date:       String,
      sampleDate: String,      // lab tests
      reportDate: String,      // lab tests
      patientId:  String,      // lab tests
    },

    // ── PRESCRIPTION fields ───────────────────────────────
    doctorInfo: {
      name:           String,
      specialization: String,
      licenseNumber:  String,
      clinic:         String,
      contact:        String,
    },
    medications: [medicationSchema],
    diagnosis:   String,

    // ── LAB TEST fields ───────────────────────────────────
    labInfo: {
      labName:    String,
      labAddress: String,
      contact:    String,
      referredBy: String,
      reportId:   String,
    },
    tests:         [testResultSchema],
    summary:       String,
    criticalValues:[String],

    // ── RADIOLOGY fields ──────────────────────────────────
    studyInfo: {
      studyType:   String,    // X-Ray, MRI, CT Scan, Ultrasound
      bodyPart:    String,    // Chest, Brain, Abdomen
      referredBy:  String,
      radiologist: String,
      center:      String,
    },
    findings:        String,
    impression:      String,
    recommendations: String,

    // ── Common fields (all types) ─────────────────────────
    additionalNotes: String,
    confidence:      { type: String, enum: ["high", "medium", "low"] },
    warnings:        [String],
    meta: {
      processingTime: Number,
      imageSize:      Number,
    },
  },
  { timestamps: true }  // adds createdAt + updatedAt automatically
);

// ── Indexes for faster queries ───────────────────────────────
prescriptionSchema.index({ user: 1, createdAt: -1 });       // user history
prescriptionSchema.index({ user: 1, documentType: 1 });     // filter by type
prescriptionSchema.index({ "tests.status": 1 });            // find critical results

module.exports = mongoose.model("Prescription", prescriptionSchema);