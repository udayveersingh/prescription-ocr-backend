/**
 * validateImage.js - Middleware to validate uploaded images
 */

function validateImage(req, res, next) {
  req.startTime = Date.now();

  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: "No image file provided. Send image as multipart form-data with field name 'image'",
    });
  }

  if (req.file.size < 1000) {
    return res.status(400).json({
      success: false,
      error: "Image file is too small. Please upload a clear photo of the prescription.",
    });
  }

  next();
}

module.exports = { validateImage };