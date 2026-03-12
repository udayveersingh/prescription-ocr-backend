const mongoose = require("mongoose");

const medicationSchema = new mongoose.Schema({
  name: String,
  genericName: String,
  dosage: String,
  frequency: String,
  duration: String,
  instructions: String,
  quantity: String
});

const prescriptionSchema = new mongoose.Schema({

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },

  patientInfo: {
    name: String,
    age: String,
    gender: String,
    date: String
  },
  imagePath: {
    type: String
    },

  doctorInfo: {
    name: String,
    specialization: String,
    licenseNumber: String,
    clinic: String,
    contact: String
  },

  medications: [medicationSchema],

  diagnosis: String,

  additionalNotes: String,

  confidence: String,

  warnings: [String],

  meta: {
    processingTime: Number,
    imageSize: Number
  }

}, { timestamps: true });

module.exports = mongoose.model("Prescription", prescriptionSchema);