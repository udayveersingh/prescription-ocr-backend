/**
 * ocrService.js
 * Pre-processes images before sending to AI:
 * - Converts HEIC → JPEG (iPhone photos)
 * - Sharpens + increases contrast for handwritten text
 * - Normalizes to reasonable size (not too large = saves API cost)
 */

const sharp = require("sharp");
const vision = require("@google-cloud/vision");
const client = new vision.ImageAnnotatorClient();

/**
 * Process and enhance image for better OCR/AI reading
 * @param {Buffer} imageBuffer - Raw image buffer
 * @returns {Buffer} - Processed image buffer
 */
async function processImage(imageBuffer) {
  try {
    const processed = await sharp(imageBuffer)
      // Auto-rotate based on EXIF (phone photos are often rotated)
      .rotate()
      // Resize: max 1600px on longest side — enough for text, not wasteful
      .resize(1600, 1600, {
        fit: "inside",
        withoutEnlargement: true,
      })
      // Grayscale helps with handwritten text contrast
      .grayscale()
      // Boost contrast significantly for prescriptions
      .normalise()
      // Sharpen edges (helps with handwriting)
      .sharpen({ sigma: 1.5, m1: 0.5, m2: 3 })
      // Linear adjustment: slight brightness boost
      .linear(1.1, -10)
      // Output as JPEG with good quality
      .jpeg({ quality: 90, progressive: false })
      .toBuffer();

    return processed;
  } catch (err) {
    console.error("Image processing error:", err.message);
    // If sharp fails, return original buffer (let AI handle it)
    return imageBuffer;
  }
}

/**
 * Get basic image metadata
 */
async function getImageInfo(imageBuffer) {
  return sharp(imageBuffer).metadata();
}

/**
 * Extract text using Google Vision OCR
 * @param {Buffer} imageBuffer
 * @returns {Object} { text, confidence }
 */
async function extractTextFromImage(imageBuffer) {
  try {
    const [result] = await client.documentTextDetection({
      image: { content: imageBuffer },
    });

    const text = result.fullTextAnnotation?.text || "";

    const confidence =
      result.fullTextAnnotation?.pages?.[0]?.confidence || null;

    return { text, confidence };
  } catch (err) {
    console.error("OCR Error:", err.message);
    return { text: "", confidence: null };
  }
}

module.exports = { processImage, getImageInfo, extractTextFromImage };