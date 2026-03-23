const mongoose = require("mongoose");

const healthQRSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  familyMember: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "FamilyMember",
    default: null, // null = the user themselves
  },
  duration: {
    type: String,
    enum: ["30min", "6hr", "4wk", "forever"],
    required: true,
  },
  expiresAt: {
    type: Date,
    default: null, // null = never expires (forever)
  },
  isRevoked: {
    type: Boolean,
    default: false,
  },
}, { timestamps: true });

healthQRSchema.index({ token: 1 });
healthQRSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("HealthQR", healthQRSchema);