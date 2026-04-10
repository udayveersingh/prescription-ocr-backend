const express      = require("express");
const router       = express.Router();
const authMiddleware = require("./../middleware/authMiddleware"); // your existing JWT middleware
const FamilyMember = require("../models/FamilyMember");
const Prescription = require("../models/Prescription");

// ── GET /api/family ── list all members with scan count
router.get("/", authMiddleware, async (req, res) => {
  try {
    const members = await FamilyMember.find({ user: req.user.id }).sort({ createdAt: 1 });

    const withCounts = await Promise.all(
      members.map(async (m) => {
        const count = await Prescription.countDocuments({
          user: req.user.id,
          familyMember: m._id,
          archived: { $ne: true }
        });
        return { ...m.toObject(), scanCount: count };
      })
    );

    res.json({ success: true, data: withCounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/family ── add new member
router.post("/", authMiddleware, async (req, res) => {
  try {
    const { name, relation } = req.body;
    if (!name || !relation)
      return res.status(400).json({ success: false, error: "Name and relation required" });

    const member = await FamilyMember.create({ user: req.user.id, name, relation });
    res.json({ success: true, data: { ...member.toObject(), scanCount: 0 } });
  } catch (err) {
    // duplicate key error
    if (err.code === 11000)
      return res.status(400).json({ success: false, error: "Member already exists" });
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PUT /api/family/:id ── edit member
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    const { name, relation } = req.body;
    const member = await FamilyMember.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { name, relation },
      { new: true, runValidators: true }
    );
    if (!member)
      return res.status(404).json({ success: false, error: "Member not found" });
    res.json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /api/family/:id ── remove member
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const member = await FamilyMember.findOne({ _id: req.params.id, user: req.user.id });
    if (!member)
      return res.status(404).json({ success: false, error: "Not found" });
    if (member.relation === "Self")
      return res.status(400).json({ success: false, error: "Cannot delete Self" });

    await member.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put("/api/family/:id", authMiddleware, async (req, res) => {
  try {
    const { name, relation } = req.body;
    const member = await FamilyMember.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      { name, relation },
      { new: true }
    );
    if (!member) return res.status(404).json({ error: "Member not found" });
    res.json({ success: true, data: member });
  } catch (err) {
    res.status(500).json({ error: "Failed to update member" });
  }
});

module.exports = router;