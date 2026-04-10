const express = require("express");
const crypto = require("crypto");
const Prescription = require("../models/Prescription");
const HealthQR = require("../models/HealthQR");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

// ── Helper: compute expiry date ──────────────────────────────
function getExpiryDate(duration) {
  const now = new Date();
  switch (duration) {
    case "30min": return new Date(now.getTime() + 30 * 60 * 1000);
    case "6hr":   return new Date(now.getTime() + 6 * 60 * 60 * 1000);
    case "4wk":   return new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
    case "forever": return null;
    default: return null;
  }
}

// ── Helper: build compact summary from prescriptions ─────────
function buildSummary(prescriptions) {
  if (!prescriptions.length) {
    return { n: "Patient", meds: [], diag: [], labs: [], hist: [], rad: [] };
  }

  const latest = prescriptions[0];
  let p = latest.patientInfo || {};

  console.log("patient ;;;;;;", p.name);
  if(!p.name){
    let latest_2 = prescriptions[1];
    p = latest_2.patientInfo || {};
    console.log("no patient detail ;;;;");
  }

  const diag = [...new Set(prescriptions.map(x => x.diagnosis).filter(Boolean))];

  const recentRx = prescriptions.filter(x => x.documentType === "prescription").slice(0, 3);
  const meds = recentRx.flatMap(x => (x.medications || []).map(m => ({
    n: m.name, g: m.genericName || null,
    d: m.dosage || null, f: m.frequency || null, i: m.instructions || null,
  })));

  const labs = prescriptions
    .filter(x => x.documentType === "lab_test")
    .flatMap(x => (x.tests || []).filter(t => t.status !== "normal"))
    .slice(0, 8)
    .map(t => ({ n: t.testName, v: t.value, u: t.unit || null, r: t.referenceRange || null, s: t.status }));

  const hist = recentRx.map(x => ({
    dr: x.doctorInfo?.name || null,
    sp: x.doctorInfo?.specialization || null,
    cl: x.doctorInfo?.clinic || null,
    date: x.patientInfo?.date || null,
  }));

  const rad = prescriptions
    .filter(x => x.documentType === "radiology").slice(0, 2)
    .map(x => ({
      t: x.studyInfo?.studyType || null, bp: x.studyInfo?.bodyPart || null,
      im: x.impression || null, dt: x.patientInfo?.date || null,
    }));

    console.log("patient detail ;;;;;;", p);
  return { n: p.name || null, a: p.age || null, g: p.gender || null, diag, meds, labs, hist, rad };
}

// ─────────────────────────────────────────────────────────────
// POST /api/healthqr/generate  (auth required)
// Body: { duration, familyMemberId? }
// ─────────────────────────────────────────────────────────────
router.post("/generate", authMiddleware, async (req, res) => {
  try {
    const { duration, familyMemberId } = req.body;

    if (!["30min", "6hr", "4wk", "forever"].includes(duration)) {
      return res.status(400).json({ success: false, error: "Invalid duration" });
    }

    // Build query
    const query = { user: req.user.id, archived: { $ne: true } };
    query.familyMember = familyMemberId || null;

    const prescriptions = await Prescription.find(query).sort({ patientParsedDate: -1 });
    const summary = buildSummary(prescriptions);

    // Create token + save to DB
    const token = crypto.randomBytes(12).toString("base64url");
    const expiresAt = getExpiryDate(duration);

    await HealthQR.create({
      token,
      user: req.user.id,
      familyMember: familyMemberId || null,
      duration,
      expiresAt,
    });

    return res.json({ success: true, token, expiresAt });
  } catch (err) {
    console.error("HealthQR generate error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/healthqr/share/:token  (PUBLIC — no auth)
// Fetches fresh data from DB and renders the HTML page
// ─────────────────────────────────────────────────────────────
router.get("/share/:token", async (req, res) => {
  try {
    console.log("this is share page ;;;;;");
    // ✅ Remove the restrictive CSP — allow inline scripts
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline';");

    const record = await HealthQR.findOne({ token: req.params.token });

    // Not found or revoked
    if (!record || record.isRevoked) {
      return res.send(sharePage(null, "invalid"));
    }

    // Expired
    if (record.expiresAt && new Date() > record.expiresAt) {
      return res.send(sharePage(null, "expired", record.expiresAt));
    }

    // Fetch fresh patient data
    const query = { user: record.user, familyMember: record.familyMember };
    const prescriptions = await Prescription.find(query).sort({ patientParsedDate: -1 });
    const summary = buildSummary(prescriptions);

    return res.send(sharePage(summary, null, record.expiresAt));
  } catch (err) {
    console.error("HealthQR share error:", err);
    res.send(sharePage(null, "invalid"));
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/healthqr/:token  (auth required — revoke)
// ─────────────────────────────────────────────────────────────
router.delete("/:token", authMiddleware, async (req, res) => {
  try {
    await HealthQR.findOneAndUpdate(
      { token: req.params.token, user: req.user.id },
      { isRevoked: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

// sharePage(summary, errorType, expiresAt)
// summary = object | null
// errorType = "expired" | "invalid" | null
// expiresAt = Date | null
function sharePage(summary, errorType, expiresAt) {
  // ✅ Safe serialization — escapes all special chars for inline script
  const dataJson = JSON.stringify(summary ?? null);
  const expJson  = JSON.stringify(expiresAt ? new Date(expiresAt).toISOString() : null);
  const errJson  = JSON.stringify(errorType ?? null);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>HealthQR™ · parchi.co.in</title>
  <style>
    /* ... all your CSS ... */
    #loading { display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .spinner { width:36px; height:36px; border-radius:50%; border:3px solid #e8e4dc; border-top-color:#2ba55d; animation:spin 0.7s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
  </style>
</head>
<body>
<div id="loading"><div class="spinner"></div></div>
<div id="app" style="display:none"></div>

<script>
  // ── Wrap everything in try/catch so errors are visible ──
  try {
    var __DATA__  = ${dataJson};
    var __EXP__   = ${expJson};
    var __ERROR__ = ${errJson};

    var loading = document.getElementById("loading");
    var app     = document.getElementById("app");

    loading.style.display = "none";
    app.style.display     = "block";

    if (__ERROR__ === "expired") {
      app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px"><div style="background:#fff;border-radius:20px;padding:32px 24px;max-width:360px;width:100%;text-align:center"><div style="font-size:48px;margin-bottom:16px">⏰</div><div style="font-size:20px;font-weight:700;margin-bottom:8px">QR Expired</div><p style="font-size:14px;color:#6b7280">Ask the patient to generate a new one.</p></div></div>';
    } else if (__ERROR__ === "invalid" || !__DATA__) {
      app.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px"><div style="background:#fff;border-radius:20px;padding:32px 24px;max-width:360px;width:100%;text-align:center"><div style="font-size:48px;margin-bottom:16px">⚠️</div><div style="font-size:20px;font-weight:700;margin-bottom:8px">Invalid QR</div><p style="font-size:14px;color:#6b7280">This QR code is invalid or has been revoked.</p></div></div>';
    } else {
      render(__DATA__, __EXP__);
    }

  } catch(e) {
    // ✅ Show error visibly instead of blank page
    document.getElementById("loading").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.getElementById("app").innerHTML =
      '<div style="padding:24px;font-family:monospace;color:red">'
      + '<strong>Script Error:</strong><br/>' + e.message + '</div>';
  }

  // ── Render functions ──────────────────────────────────────
  function fmt(iso) {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-IN", { day:"numeric", month:"short", year:"numeric" });
  }

  function renderMeds(meds) {
    if (!meds || !meds.length) return '<p style="font-size:13px;color:#9ca3af">No medications on record</p>';
    return meds.map(function(m) {
      var meta = [m.d, m.f, m.i].filter(Boolean).join(" · ");
      return '<div style="padding:10px 0;border-bottom:1px solid #f3f4f6">'
        + '<div style="font-size:14px;font-weight:600">' + escHtml(m.n)
        + (m.g ? ' <span style="font-weight:400;color:#6b7280">(' + escHtml(m.g) + ')</span>' : '') + '</div>'
        + (meta ? '<div style="font-size:12px;color:#6b7280;margin-top:2px">' + escHtml(meta) + '</div>' : '')
        + '</div>';
    }).join("");
  }

  function renderLabs(labs) {
    if (!labs || !labs.length) return '<p style="font-size:13px;color:#9ca3af">No abnormal lab values</p>';
    return labs.map(function(t) {
      var color = t.s === "high" || t.s === "critical" ? "#dc2626" : t.s === "low" ? "#d97706" : "#1a1a1a";
      return '<div style="padding:10px 0;border-bottom:1px solid #f3f4f6">'
        + '<div style="display:flex;justify-content:space-between;align-items:center">'
        + '<span style="font-size:14px;font-weight:600">' + escHtml(t.n) + '</span>'
        + '<span style="font-size:15px;font-weight:700;color:' + color + '">' + escHtml(t.v) + (t.u ? ' ' + escHtml(t.u) : '') + '</span>'
        + '</div>'
        + (t.r ? '<div style="font-size:11px;color:#9ca3af;margin-top:2px">Ref: ' + escHtml(t.r) + '</div>' : '')
        + '</div>';
    }).join("");
  }

  function renderHist(hist) {
    if (!hist || !hist.length) return '<p style="font-size:13px;color:#9ca3af">No history</p>';
    return hist.map(function(h) {
      var sub = [h.sp, h.cl].filter(Boolean).join(" · ");
      return '<div style="padding:10px 0;border-bottom:1px solid #f3f4f6;display:flex;justify-content:space-between">'
        + '<div><div style="font-size:14px;font-weight:600">' + escHtml(h.dr || "Unknown Doctor") + '</div>'
        + (sub ? '<div style="font-size:12px;color:#6b7280;margin-top:2px">' + escHtml(sub) + '</div>' : '') + '</div>'
        + (h.date ? '<div style="font-size:11px;color:#9ca3af;white-space:nowrap;margin-left:8px">' + escHtml(h.date) + '</div>' : '')
        + '</div>';
    }).join("");
  }

  function escHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function render(d, exp) {
    var app    = document.getElementById("app");
    var name   = escHtml(d.n || "Patient");
    var demo   = [d.a ? d.a + " yrs" : null, d.g].filter(Boolean).join(" · ");
    var expiry = exp ? "Expires " + fmt(exp) : "No expiry";

    // Build demographic chips
  var chips = [];
  if (d.a) chips.push("🎂 " + d.a + " yrs");
  if (d.g) chips.push("👤 " + d.g);
  if (d.ph) chips.push("📞 " + d.ph);
  if (d.id) chips.push("🪪 " + d.id);
  var chipsHtml = chips.map(function(c) {
    return '<span style="background:rgba(255,255,255,0.2);padding:4px 10px;border-radius:999px;font-size:12px;font-weight:600">' + escHtml(c) + '</span>';
  }).join("");

    var diags  = (d.diag || []).map(function(x) {
      return '<span style="background:#e8f7ee;color:#1a7a43;font-size:13px;font-weight:600;padding:6px 12px;border-radius:999px">' + escHtml(x) + '</span>';
    }).join("") || '<p style="font-size:13px;color:#9ca3af">No diagnosis on record</p>';

    app.innerHTML =
      // Topbar
      '<div style="background:#fff;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e8e4dc;position:sticky;top:0;z-index:10">'
      + '<div style="font-size:17px;font-weight:800">parchi<span style="color:#2ba55d">.co.in</span></div>'
      + '<div style="font-size:11px;font-weight:600;background:#e8f7ee;color:#2ba55d;padding:4px 10px;border-radius:999px">🕐 ' + expiry + '</div>'
      + '</div>'
      // Hero
      + '<div style="background:linear-gradient(135deg,#2ba55d,#22c26e);padding:24px 20px 28px;color:#fff">'
      + '<div style="font-size:28px;font-weight:800">' + name + '</div>'
      + (demo ? '<div style="font-size:14px;opacity:0.85;margin-top:4px">' + escHtml(demo) + '</div>' : '')
      + '<div style="margin-top:14px;background:rgba(255,255,255,0.15);border-radius:10px;padding:10px 14px;font-size:12px;line-height:1.5">📋 Health summary shared via HealthQR™.<br/>For clinical reference — not a substitute for consultation.</div>'
      + '</div>'
         // ── Patient Details card ──
    + section("Patient Details", patientDetailsHtml(d))
      // Diagnoses
      + section("Diagnoses / Conditions", '<div style="display:flex;flex-wrap:wrap;gap:8px">' + diags + '</div>')
      // Medications
      + section("Current Medications", renderMeds(d.meds))
      // Labs
      + section("Notable Lab Results", renderLabs(d.labs))
      // History
      + section("Prescription History", renderHist(d.hist))
      // Footer
      + '<div style="text-align:center;margin-top:28px;font-size:12px;color:#9ca3af;padding:0 20px">'
      + '<p>Shared via <strong style="color:#1a1a1a">parchi<span style="color:#2ba55d">.co.in</span></strong> HealthQR™</p>'
      + '<p style="margin-top:6px">🔒 Time-limited · Patient-controlled</p></div>';
  }

  // ── New: patient details card ──
function patientDetailsHtml(d) {
  var rows = [];
  if (d.n)  rows.push(["Full Name",   d.n]);
  if (d.a)  rows.push(["Age",         d.a + " years"]);
  if (d.g)  rows.push(["Gender",      d.g]);
  if (d.ph) rows.push(["Phone",       d.ph]);
  if (d.id) rows.push(["Patient ID",  d.id]);

  if (!rows.length) return '<p style="font-size:13px;color:#9ca3af;margin:0">No patient details available</p>';

  return rows.map(function(r, i) {
    var isLast = i === rows.length - 1;
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;'
      + (isLast ? '' : 'border-bottom:1px solid #f3f4f6') + '">'
      + '<span style="font-size:12px;color:#6b7280;font-weight:500">' + r[0] + '</span>'
      + '<span style="font-size:14px;font-weight:600;color:#1a1a1a">' + escHtml(r[1]) + '</span>'
      + '</div>';
  }).join("");
}


  function section(title, content) {
    return '<div style="margin:14px 16px 0">'
      + '<div style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">' + title + '</div>'
      + '<div style="background:#fff;border-radius:16px;padding:16px;border:1px solid #e8e4dc;box-shadow:0 2px 8px rgba(0,0,0,0.04)">' + content + '</div>'
      + '</div>';
  }
</script>
</body>
</html>`;
}