function parsePatientDateString(dateStr, docId) {
  if (!dateStr) return null;

  // Format 1: "21/03/26" → DD/MM/YY
  const ddmmyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (ddmmyy) {
    const [, d, m, y] = ddmmyy;
    return new Date(`20${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
  }

  // Format 2: "24/04/2024" or "27/1/2025" → DD/MM/YYYY
  const ddmmyyyy = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return new Date(`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`);
  }

  // Format 3: "April 24, 2024" or "Apr 24, 2024" → natural language
  const naturalDate = new Date(dateStr);
  if (!isNaN(naturalDate.valueOf())) return naturalDate;

  // Unknown format — log for manual check
  console.log(`⚠️ Unknown date format | doc: ${docId} | date: "${dateStr}"`);
  return null;
}

module.exports = { parsePatientDateString };