const express = require("express");
const router = express.Router();
const adminMiddleware = require("../middleware/adminMiddleware");
const {
  getUsersData,
  loginAdmin,
  getDocumentsData,
  updateUser,
  deleteFamilyMember,
  deleteUser,
  familyMemberData,
  findFamilyMemberDocuments,
  getDocumetStream,
  getUserStream,
} = require("../controllers/adminController");

// Auth
router.post("/login", loginAdmin);

// Read
router.get("/users", adminMiddleware, getUsersData);
router.get("/documents", adminMiddleware, getDocumentsData);
router.post("/familyMembers", adminMiddleware, familyMemberData);

// Update - FIXED: Added missing slash
router.patch("/update-user", adminMiddleware, updateUser);

// Delete
router.delete("/delete-member", adminMiddleware, deleteFamilyMember);
router.delete("/delete-user", adminMiddleware, deleteUser);

router.get("/findFamilyMemberDocuments/:userId",adminMiddleware, findFamilyMemberDocuments,
);

router.get("/documentStream",adminMiddleware,getDocumetStream)

router.get("/userStream",adminMiddleware,getUserStream)

module.exports = router;
