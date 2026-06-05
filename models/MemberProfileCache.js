// models/MemberProfileCache.js
const mongoose = require("mongoose");

const memberProfileCacheSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    familyMember: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FamilyMember",
      default: null,
    },
    documentCount: {
      type: Number,
      required: true,
    },
    // ── Cached AI data ──
    aiSummary:       { type: String, default: "" },
    detailedSummary: {
      activeFocus:       { type: String, default: "" },
      chronicManagement: { type: String, default: "" },
      generalOutlook:    { type: String, default: "" },
    },
    trends: { type: [mongoose.Schema.Types.Mixed], default: [] },
    // ── Cached structured data ──
    chronicConditions: [String],
    activeMeds: [mongoose.Schema.Types.Mixed],
    latestLabs: [mongoose.Schema.Types.Mixed],
  },
  { timestamps: true }
);

// One cache entry per user+familyMember combo
memberProfileCacheSchema.index(
  { user: 1, familyMember: 1 },
  { unique: true }
);

module.exports = mongoose.model("MemberProfileCache", memberProfileCacheSchema);