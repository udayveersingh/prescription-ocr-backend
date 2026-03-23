const express = require("express");
const Prescription = require("../models/Prescription");
const authMiddleware = require("./../middleware/authMiddleware");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/healthqr/summary
// Returns compact patient summary — embedded into QR URL hash by the app
// Query: ?familyMemberId=xxx (optional)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/summary", authMiddleware, async (req, res) => {
  try {
    const query = { user: req.user.id };
    if (req.query.familyMemberId) {
      query.familyMember = req.query.familyMemberId;
    } else {
      query.familyMember = null;
    }

    const prescriptions = await Prescription
      .find(query)
      .sort({ patientParsedDate: -1 });

    if (!prescriptions.length) {
      return res.json({ success: true, summary: { n: "Patient", meds: [], diag: [], labs: [] } });
    }

    const latest = prescriptions[0];

    // ── Patient info (from most recent record) ──
    const p = latest.patientInfo || {};

    // ── All unique diagnoses ──
    const diag = [...new Set(
      prescriptions.map(x => x.diagnosis).filter(Boolean)
    )];

    // ── Medications from last 3 prescriptions ──
    const recentRx = prescriptions.filter(x => x.documentType === "prescription").slice(0, 3);
    const meds = recentRx.flatMap(x => (x.medications || []).map(m => ({
      n: m.name,
      g: m.genericName || null,
      d: m.dosage || null,
      f: m.frequency || null,
      i: m.instructions || null,
    })));

    // ── Notable lab results (abnormal only) ──
    const labs = prescriptions
      .filter(x => x.documentType === "lab_test")
      .flatMap(x => (x.tests || []).filter(t => t.status !== "normal"))
      .slice(0, 8)
      .map(t => ({
        n: t.testName,
        v: t.value,
        u: t.unit || null,
        r: t.referenceRange || null,
        s: t.status,
      }));

    // ── Recent prescription history (for context) ──
    const hist = recentRx.map(x => ({
      dr:   x.doctorInfo?.name || null,
      sp:   x.doctorInfo?.specialization || null,
      cl:   x.doctorInfo?.clinic || null,
      date: x.patientInfo?.date || null,
    }));

    // ── Radiology impressions ──
    const rad = prescriptions
      .filter(x => x.documentType === "radiology")
      .slice(0, 2)
      .map(x => ({
        t:  x.studyInfo?.studyType || null,
        bp: x.studyInfo?.bodyPart || null,
        im: x.impression || null,
        dt: x.patientInfo?.date || null,
      }));

    const summary = {
      n:    p.name    || null,   // name
      a:    p.age     || null,   // age
      g:    p.gender  || null,   // gender
      diag,                      // diagnoses array
      meds,                      // medications array
      labs,                      // lab results array
      hist,                      // prescription history
      rad,                       // radiology
    };

    return res.json({ success: true, summary });
  } catch (err) {
    console.error("HealthQR summary error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /share   (PUBLIC — no auth)
// This is the page the doctor's phone browser opens when they scan the QR.
// All patient data is in the URL hash — decoded client-side in JS.
// No server DB lookup needed.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/share", (req, res) => {
     res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline';"
  );
  res.send(sharePage());
});

module.exports = router;

// ─────────────────────────────────────────────────────────────────────────────
// The share HTML page — reads #hash, decodes base64 JSON, renders patient info
// ─────────────────────────────────────────────────────────────────────────────
function sharePage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/>
  <title>HealthQR™ · parchi.co.in</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; -webkit-tap-highlight-color:transparent; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f5f3ef;
      color: #1a1a1a;
      padding-bottom: 48px;
    }

    /* ── Top bar ── */
    .topbar {
      background: #fff;
      padding: 14px 20px;
      display: flex; align-items: center; justify-content: space-between;
      border-bottom: 1px solid #e8e4dc;
      position: sticky; top: 0; z-index: 10;
    }
    .brand { font-size: 17px; font-weight: 800; }
    .brand span { color: #2ba55d; }
    .expiry-badge {
      font-size: 11px; font-weight: 600;
      background: #e8f7ee; color: #2ba55d;
      padding: 4px 10px; border-radius: 999px;
    }
    .expiry-badge.expired {
      background: #fee2e2; color: #dc2626;
    }

    /* ── Patient hero ── */
    .hero {
      background: linear-gradient(135deg, #2ba55d, #22c26e);
      padding: 24px 20px 28px;
      color: #fff;
    }
    .patient-name { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; }
    .patient-demo { font-size: 14px; opacity: 0.85; margin-top: 4px; }
    .disclaimer {
      margin-top: 14px;
      background: rgba(255,255,255,0.15);
      border-radius: 10px; padding: 10px 14px;
      font-size: 12px; line-height: 1.5; opacity: 0.9;
    }

    /* ── Sections ── */
    .section { margin: 14px 16px 0; }
    .section-title {
      font-size: 11px; font-weight: 700; color: #6b7280;
      text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px;
    }
    .card {
      background: #fff; border-radius: 16px; padding: 16px;
      border: 1px solid #e8e4dc;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }

    /* ── Tags ── */
    .tags { display: flex; flex-wrap: wrap; gap: 8px; }
    .tag {
      background: #e8f7ee; color: #1a7a43;
      font-size: 13px; font-weight: 600;
      padding: 6px 12px; border-radius: 999px;
    }

    /* ── Medications ── */
    .med-row { padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .med-row:first-child { padding-top: 0; }
    .med-row:last-child  { border-bottom: none; padding-bottom: 0; }
    .med-name { font-size: 14px; font-weight: 600; }
    .med-generic { font-weight: 400; color: #6b7280; font-size: 13px; }
    .med-meta { font-size: 12px; color: #6b7280; margin-top: 2px; }

    /* ── Lab results ── */
    .lab-row { padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .lab-row:first-child { padding-top: 0; }
    .lab-row:last-child  { border-bottom: none; padding-bottom: 0; }
    .lab-top { display: flex; align-items: center; justify-content: space-between; }
    .lab-name { font-size: 14px; font-weight: 600; }
    .lab-val  { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .lab-ref  { font-size: 11px; color: #9ca3af; margin-top: 2px; }
    .badge {
      font-size: 10px; font-weight: 700; padding: 2px 8px;
      border-radius: 999px; text-transform: uppercase; margin-left: 6px;
    }
    .badge.high, .badge.critical { background: #fee2e2; color: #dc2626; }
    .badge.low  { background: #fef3c7; color: #d97706; }
    .high .lab-val, .critical .lab-val { color: #dc2626; }
    .low  .lab-val { color: #d97706; }

    /* ── History ── */
    .hist-row {
      display: flex; justify-content: space-between;
      padding: 10px 0; border-bottom: 1px solid #f3f4f6;
    }
    .hist-row:first-child { padding-top: 0; }
    .hist-row:last-child  { border-bottom: none; padding-bottom: 0; }
    .hist-dr   { font-size: 14px; font-weight: 600; }
    .hist-sub  { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .hist-date { font-size: 11px; color: #9ca3af; white-space: nowrap; margin-left: 8px; flex-shrink: 0; }

    /* ── Radiology ── */
    .rad-row { padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
    .rad-row:first-child { padding-top: 0; }
    .rad-row:last-child  { border-bottom: none; padding-bottom: 0; }
    .rad-type { font-size: 14px; font-weight: 600; }
    .rad-imp  { font-size: 13px; color: #374151; margin-top: 4px; line-height: 1.5; }

    /* ── Empty ── */
    .empty { font-size: 13px; color: #9ca3af; }

    /* ── Error / expired ── */
    .error-wrap {
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 24px;
    }
    .error-card {
      background: #fff; border-radius: 20px; padding: 32px 24px;
      max-width: 360px; width: 100%; text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .error-icon { font-size: 48px; margin-bottom: 16px; }
    .error-title { font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .error-msg   { font-size: 14px; color: #6b7280; line-height: 1.6; }

    /* ── Footer ── */
    .footer { text-align: center; margin-top: 28px; font-size: 12px; color: #9ca3af; padding: 0 20px; }
    .footer strong { color: #1a1a1a; }
    .footer em { color: #2ba55d; font-style: normal; }

    /* ── Loading ── */
    #loading { display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .spinner {
      width: 36px; height: 36px; border-radius: 50%;
      border: 3px solid #e8e4dc; border-top-color: #2ba55d;
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>

<div id="loading"><div class="spinner"></div></div>
<div id="app" style="display:none"></div>

<script>
(function () {

  // ── Decode base64 hash ──────────────────────────────────────────────────
  function decode(encoded) {
    try {
      return JSON.parse(decodeURIComponent(escape(atob(encoded))));
    } catch {
      return null;
    }
  }

  // ── Check expiry ────────────────────────────────────────────────────────
  function isExpired(exp) {
    if (!exp) return false;
    return new Date() > new Date(exp);
  }

  // ── Format date ─────────────────────────────────────────────────────────
  function fmt(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  }

  // ── Render helpers ──────────────────────────────────────────────────────
  function tag(cls, html) { return '<span class="tag">' + html + '</span>'; }

  function renderMeds(meds) {
    if (!meds || !meds.length) return '<p class="empty">No medications on record</p>';
    return meds.map(function(m) {
      var meta = [m.d, m.f, m.i].filter(Boolean).join(" · ");
      return '<div class="med-row">'
        + '<div class="med-name">' + m.n
        + (m.g ? ' <span class="med-generic">(' + m.g + ')</span>' : '')
        + '</div>'
        + (meta ? '<div class="med-meta">' + meta + '</div>' : '')
        + '</div>';
    }).join("");
  }

  function renderLabs(labs) {
    if (!labs || !labs.length) return '<p class="empty">No abnormal lab values</p>';
    return labs.map(function(t) {
      return '<div class="lab-row ' + t.s + '">'
        + '<div class="lab-top">'
        + '<span class="lab-name">' + t.n + '</span>'
        + '<span>'
        + '<span class="lab-val">' + t.v + (t.u ? ' ' + t.u : '') + '</span>'
        + '<span class="badge ' + t.s + '">' + t.s.toUpperCase() + '</span>'
        + '</span>'
        + '</div>'
        + (t.r ? '<div class="lab-ref">Ref: ' + t.r + '</div>' : '')
        + '</div>';
    }).join("");
  }

  function renderHist(hist) {
    if (!hist || !hist.length) return '<p class="empty">No history</p>';
    return hist.map(function(h) {
      var sub = [h.sp, h.cl].filter(Boolean).join(" · ");
      return '<div class="hist-row">'
        + '<div>'
        + '<div class="hist-dr">' + (h.dr || "Unknown Doctor") + '</div>'
        + (sub ? '<div class="hist-sub">' + sub + '</div>' : '')
        + '</div>'
        + (h.date ? '<div class="hist-date">' + h.date + '</div>' : '')
        + '</div>';
    }).join("");
  }

  function renderRad(rad) {
    if (!rad || !rad.length) return null;
    return rad.map(function(r) {
      return '<div class="rad-row">'
        + '<div class="rad-type">' + (r.t || "Study") + (r.bp ? " — " + r.bp : "") + '</div>'
        + (r.dt ? '<div class="hist-sub">' + r.dt + '</div>' : '')
        + (r.im ? '<div class="rad-imp">' + r.im + '</div>' : '')
        + '</div>';
    }).join("");
  }

  // ── Main render ─────────────────────────────────────────────────────────
  function render(d) {
    var app = document.getElementById("app");

    // Expiry check
    if (isExpired(d.exp)) {
      app.innerHTML = '<div class="error-wrap"><div class="error-card">'
        + '<div class="error-icon">⏰</div>'
        + '<div class="error-title">QR Expired</div>'
        + '<p class="error-msg">This HealthQR expired on ' + fmt(d.exp) + '.<br/>Ask the patient to generate a new one.</p>'
        + '<p style="margin-top:20px;font-size:13px;font-weight:700">parchi<span style="color:#2ba55d">.co.in</span></p>'
        + '</div></div>';
      return;
    }

    var name   = d.n || "Patient";
    var demo   = [d.a ? d.a + " yrs" : null, d.g].filter(Boolean).join(" · ");
    var expiry = d.exp ? "Expires " + fmt(d.exp) : "No expiry";
    var diags  = (d.diag || []).map(function(x) { return tag("tag", x); }).join("") || '<p class="empty">No diagnosis on record</p>';
    var radHtml = renderRad(d.rad);

    app.innerHTML =
      // Top bar
      '<div class="topbar">'
      + '<div class="brand">parchi<span>.co.in</span></div>'
      + '<div class="expiry-badge">🕐 ' + expiry + '</div>'
      + '</div>'

      // Hero
      + '<div class="hero">'
      + '<div class="patient-name">' + name + '</div>'
      + (demo ? '<div class="patient-demo">' + demo + '</div>' : '')
      + '<div class="disclaimer">📋 Health summary shared via HealthQR™.<br/>For clinical reference — not a substitute for consultation.</div>'
      + '</div>'

      // Diagnoses
      + '<div class="section"><div class="section-title">Diagnoses / Conditions</div>'
      + '<div class="card"><div class="tags">' + diags + '</div></div></div>'

      // Medications
      + '<div class="section"><div class="section-title">Current Medications</div>'
      + '<div class="card">' + renderMeds(d.meds) + '</div></div>'

      // Lab results
      + '<div class="section"><div class="section-title">Notable Lab Results</div>'
      + '<div class="card">' + renderLabs(d.labs) + '</div></div>'

      // Prescription history
      + '<div class="section"><div class="section-title">Prescription History</div>'
      + '<div class="card">' + renderHist(d.hist) + '</div></div>'

      // Radiology (only if present)
      + (radHtml ? '<div class="section"><div class="section-title">Radiology</div><div class="card">' + radHtml + '</div></div>' : '')

      // Footer
      + '<div class="footer">'
      + '<p>Shared via <strong>parchi<em>.co.in</em></strong> HealthQR™</p>'
      + '<p style="margin-top:6px">🔒 Time-limited · Patient-controlled</p>'
      + '</div>';
  }

  // ── Boot ────────────────────────────────────────────────────────────────
  var hash = window.location.hash.slice(1);
  var loading = document.getElementById("loading");
  var app = document.getElementById("app");

  if (!hash) {
    loading.style.display = "none";
    app.style.display = "block";
    app.innerHTML = '<div class="error-wrap"><div class="error-card">'
      + '<div class="error-icon">⚠️</div>'
      + '<div class="error-title">Invalid QR</div>'
      + '<p class="error-msg">This QR code is invalid or has no data.</p>'
      + '</div></div>';
    return;
  }

  var data = decode(hash);
  loading.style.display = "none";
  app.style.display = "block";

  if (!data) {
    app.innerHTML = '<div class="error-wrap"><div class="error-card">'
      + '<div class="error-icon">⚠️</div>'
      + '<div class="error-title">Unreadable QR</div>'
      + '<p class="error-msg">Could not decode the QR data. Try scanning again.</p>'
      + '</div></div>';
    return;
  }

  render(data);

})();
</script>
</body>
</html>`;
}