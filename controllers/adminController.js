const jwt = require("jsonwebtoken");
const Prescription = require("../models/Prescription");
const FamilyMember = require("../models/FamilyMember");
const User = require("../models/User");
const bcrypt = require("bcryptjs");

const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(401).json({ error: "pls send valid data" });
    }
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.role !== "admin") {
      return res.status(402).json({
        error: "access denied !",
      });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed" });
  }
};

const getUsersData = async (req, res) => {
  try {
    const user = await User.find(); 
    const users = await FamilyMember.find();
    const userFamilyMembers = users.length - user.length
    return res.status(200).json({
      success: true,
      user,
      FamilyMembersCount:userFamilyMembers ,
      data: users,
    });
  } catch (error) {
    console.log("error in the getUsersData :", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

const getDocumentsData = async (req, res) => {
  try {
    const documents = await Prescription.find();
    const documentType = {
      prescription: 0,
      lab_test: 0,
      radiology: 0,
    };

    documents.forEach((doc) => {
      if (documentType[doc.documentType] !== undefined) {
        documentType[doc.documentType]++;
      }
    });

    return res.status(200).json({
      success: true,
      data: documents,
      documentType,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// Updated: Handles both User (self) and FamilyMember updates
const updateUser = async (req, res) => {
  const { userId, name, email, age, gender, weight, blood_group, isSelf } = req.body;

  try {
    // If updating self (FamilyMember with relation="Self")
    if (isSelf) {
      // First, find the FamilyMember record
      const familyMember = await FamilyMember.findById(userId);

      if (!familyMember) {
        return res.status(404).json({
          success: false,
          message: "Family member record not found",
        });
      }

      // Check if this is actually a "Self" record
      if (familyMember.relation.toLowerCase() !== "self") {
        return res.status(400).json({
          success: false,
          message: "This is not a self record",
        });
      }

      // Get the User ID from the FamilyMember record
      const userID = familyMember.user;

      // Update User model with name and email
      const updatedUser = await User.findByIdAndUpdate(
        userID,
        { name, email },
        { new: true }
      );

      if (!updatedUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Update FamilyMember with health data (NO upsert, just update)
      const updatedFamilyMember = await FamilyMember.findByIdAndUpdate(
        userId,
        { name, age, gender, weight, blood_group },
        { new: true }
      );

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: { user: updatedUser, familyMember: updatedFamilyMember },
      });
    }

    // If updating a family member (not self)
    const updatedMember = await FamilyMember.findByIdAndUpdate(
      userId,
      { name, age, gender, weight, blood_group },
      { new: true }
    );

    if (!updatedMember) {
      return res.status(404).json({
        success: false,
        message: "Family member not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Family member updated successfully",
      data: updatedMember,
    });
  } catch (error) {
    console.error("Update User Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};



// New: Delete family member
const deleteFamilyMember = async (req, res) => {
  console.log("i am getting the req in the deleteFamilyMember function")
  const { memberId } = req.body;

  try {
    const deletedMember = await FamilyMember.findByIdAndDelete(memberId);

    if (!deletedMember) {
      return res.status(404).json({
        success: false,
        message: "Family member not found",
      });
    }

    // Also delete related prescriptions
    await Prescription.deleteMany({ familyMember: memberId });

    return res.status(200).json({
      success: true,
      message: "Family member deleted successfully",
      data: deletedMember,
    });
  } catch (error) {
    console.error("Delete Family Member Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// New: Delete user and all associated data
const deleteUser = async (req, res) => {
  console.log("i am getting the req in the deleteUser function")

  const { userId } = req.body;

  try {
    // Delete user
    const deletedUser = await User.findByIdAndDelete(userId);

    if (!deletedUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Delete all family members for this user
    const deletedMembers = await FamilyMember.deleteMany({ user: userId });

    // Delete all prescriptions for this user
    await Prescription.deleteMany({ user: userId });

    return res.status(200).json({
      success: true,
      message: "User and all associated data deleted successfully",
      data: { user: deletedUser, membersDeleted: deletedMembers.deletedCount },
    });
  } catch (error) {
    console.error("Delete User Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

const familyMemberData = async (req, res) => {
  const { userId } = req.body;

  try {
    const members = await FamilyMember.find({ user: userId }).sort({
      createdAt: 1,
    });

    const withCounts = await Promise.all(
      members.map(async (m) => {
        const count = await Prescription.countDocuments({
          user: userId,
          familyMember: m._id,
          archived: { $ne: true },
        });
        return { ...m.toObject(), scanCount: count };
      })
    );

    res.json({ success: true, data: withCounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  loginAdmin,
  getUsersData,
  getDocumentsData,
  updateUser,
  deleteFamilyMember,
  deleteUser,
  familyMemberData,
};