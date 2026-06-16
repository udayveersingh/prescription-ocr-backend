const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },

  email: { type: String, required: true, unique: true },

  role: {
    type: String,
    enum: ["user", "admin"],
    default: "user"
  },

  password: { type: String, required: true },

  googleId: { type: String, default: null },

  termsAcceptedAt: { type: Date, default: null },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("User", userSchema);