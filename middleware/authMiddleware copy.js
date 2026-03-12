const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {

  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: "Access denied" });
  }

  try {

    const decoded = jwt.verify(
      token.replace("Bearer ", ""),
      process.env.JWT_SECRET
    );

    req.user = decoded;

    next();

  } catch (error) {
    res.status(401).json({ error: "Invalid token" });
  }

};