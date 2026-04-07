const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const FamilyMember = require("../models/FamilyMember");

exports.register = async (req, res) => {
  try {

    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "All fields required" });
    }

    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      name,
      email,
      password: hashedPassword
    });

    await user.save();

    await FamilyMember.create({
      user: user._id,
      name: user.name,
      relation: "Self",
    });

    res.json({
      success: true,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Registration failed" });
  }
};

exports.login = async (req, res) => {
  try {

    const { email, password, acceptTerms } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

     // If user hasn't accepted terms yet, and is accepting now → save it
    if (!user.termsAcceptedAt && acceptTerms) {
      console.log(`User ${user.email} accepted terms at login`);
      user.termsAcceptedAt = new Date();
      await user.save();
    }

     // If terms never accepted and not accepting now → reject
    if (!user.termsAcceptedAt && !acceptTerms) {
      console.log("term not expected");
      return res.status(403).json({ error: "terms_required" });
    }

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        termsAcceptedAt: user.termsAcceptedAt
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Login failed" });
  }
};

exports.google = async (req, res) => {
  try {
    const { googleId, email, name, acceptTerms } = req.body;
    if (!googleId || !email) 
      return res.status(400).json({ error: "googleId and email required" });

    let user = await User.findOne({ email });

    console.log("already have user ;;;;;;", user);

    if (!user) {
       if (!acceptTerms) return res.status(403).json({ error: "terms_required" });
      user = await User.create({
        name,
        email,
        password: `google_${googleId}`,
        googleId,
        termsAcceptedAt: new Date(),
      });
      await FamilyMember.create({
        user: user._id,
        name,
        relation: "Self",
      });
    }else {
      console.log("user first term accept", user.termsAcceptedAt, acceptTerms);
      if (!user.termsAcceptedAt && acceptTerms) { // ← existing user accepting for first time
        user.termsAcceptedAt = new Date();
        await user.save();
      }
      if (!user.termsAcceptedAt && !acceptTerms) return res.status(403).json({ error: "terms_required" });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "30d" });
    res.json({ success: true, token, user: { name: user.name, email: user.email } });
  } catch (err) {
    console.error("Google auth error:", err);
    res.status(401).json({ success: false, error: "Invalid Google token" });
  }
};