const mongoose = require("mongoose");

const familyMemberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    relation: {
      type: String,
      required: true,
      enum: ["Self", "Mother", "Father", "Spouse", "Son", "Daughter", "Sibling", "Other"],
    },
  },
  { timestamps: true }
);

// One user can't have duplicate relation+name combos
familyMemberSchema.index({ user: 1, name: 1, relation: 1 }, { unique: true });

module.exports = mongoose.model("FamilyMember", familyMemberSchema);