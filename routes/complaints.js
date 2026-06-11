const express = require('express');
const router = express.Router();
const { Complaint } = require('../models');
const employees = require('../employees.json');
const complaintsData = require('../data/complaints.json');
const { sendComplaintEmail } = require('../utils/email');

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function getEmployeeByPhone(phone) {
  return phone ? (employees[phone] || null) : null;
}

function extractArgs(req) {
  try {
    const list = req.body?.message?.toolCallList || req.body?.message?.toolCalls;
    if (list?.[0]?.function?.arguments) {
      const a = list[0].function.arguments;
      return typeof a === 'string' ? JSON.parse(a) : a;
    }
    return req.body;
  } catch { return req.body; }
}

function getToolCallId(req) {
  return req.body?.message?.toolCallList?.[0]?.id
    || req.body?.message?.toolCalls?.[0]?.id
    || 'tool-call-1';
}

function getCallerPhone(req) {
  return req.body?.message?.call?.customer?.number
    || req.body?.message?.customer?.number
    || null;
}

function vapiResponse(res, toolCallId, resultText) {
  return res.json({ results: [{ toolCallId, result: resultText }] });
}

// Detect complaint type from description
function detectComplaintType(description) {
  const lowerDesc = description.toLowerCase();
  for (const type of complaintsData.complaint_types) {
    if (type.id === 'OTHER') continue;
    for (const keyword of type.keywords) {
      if (lowerDesc.includes(keyword.toLowerCase())) return type;
    }
  }
  return complaintsData.complaint_types.find(t => t.id === 'OTHER');
}

// Resolve a location string to structured location info
function resolveLocation(locationStr) {
  if (!locationStr) return null;
  const lower = locationStr.toLowerCase();
  const spot = complaintsData.locations.specific_spots.find(s =>
    s.name.toLowerCase().includes(lower) ||
    lower.includes(s.name.toLowerCase()) ||
    lower.includes(s.id.toLowerCase())
  );
  return spot ? `${spot.name}, ${spot.building}, Floor ${spot.floor}` : locationStr;
}

// ─────────────────────────────────────────────
// TOOL: Raise a complaint (smart detection)
// ─────────────────────────────────────────────
router.post('/raise', async (req, res) => {
  const args        = extractArgs(req);
  const toolCallId  = getToolCallId(req);
  const phone       = getCallerPhone(req);
  const employee    = getEmployeeByPhone(phone);

  const {
    description,
    complaint_type,   // optional — agent can pass it or let us detect
    location,
    outlet_id,
    reported_person,
    quick_resolution
  } = args;

  if (!description) {
    return vapiResponse(res, toolCallId,
      'Could you describe your complaint? I need a few more details to log this properly.');
  }

  // Auto-detect type if not provided
  let typeObj = complaint_type
    ? (complaintsData.complaint_types.find(t => t.id === complaint_type) || detectComplaintType(description))
    : detectComplaintType(description);

  const resolvedLocation = resolveLocation(location);
  const count            = await Complaint.countDocuments();
  const complaintId      = `JPMC-CMP-${1001 + count}`;
  const isQuick          = !!quick_resolution || typeObj.priority === 'HIGH' || typeObj.priority === 'CRITICAL';

  const complaint = await Complaint.create({
    complaint_id:    complaintId,
    complaint_type:  typeObj.id,
    description,
    location:        resolvedLocation || location || 'Not specified',
    outlet_id:       outlet_id || null,
    reported_person: reported_person || null,
    severity:        typeObj.priority,
    assigned_team:   typeObj.assigned_team,
    sla_hours:       typeObj.sla_hours,
    quick_resolution: isQuick,
    employee_sid:    employee?.sid   || 'UNKNOWN',
    employee_name:   employee?.name  || 'Unknown Employee',
    phone_number:    phone           || 'Unknown',
    status:          'PENDING'
  });

  console.log(`⚠️  Complaint raised: ${complaint.complaint_id} | Type: ${typeObj.id} | By: ${employee?.name}`);

  // Fire email notification
  sendComplaintEmail(employee, complaint);

  // Build response message
  let msg = `Complaint ${complaintId} has been logged. `;
  msg += `It has been routed to the ${typeObj.assigned_team}. `;

  if (typeObj.id === 'SAFETY_SECURITY') {
    msg += `This is flagged as CRITICAL. Please call the security desk at extension 911 if there is an immediate threat.`;
  } else if (isQuick) {
    msg += `This is flagged for quick resolution and the team will respond within ${typeObj.sla_hours} hour(s).`;
    if (resolvedLocation || location) {
      msg += ` They will check ${resolvedLocation || location} right away.`;
    }
  } else {
    msg += `Expected response time is within ${typeObj.sla_hours} hour(s).`;
  }

  return vapiResponse(res, toolCallId, msg);
});

// ─────────────────────────────────────────────
// TOOL: Raise a facility quick-fix complaint
// (e.g., no TT ball, broken equipment, AC not working)
// ─────────────────────────────────────────────
router.post('/raise-facility', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { description, location } = args;

  if (!description || !location) {
    return vapiResponse(res, toolCallId,
      'To raise a facility complaint, I need both what the issue is and where it is. For example: "No TT ball at the TT court on Floor 4, Tower A."');
  }

  const typeObj          = complaintsData.complaint_types.find(t => t.id === 'FACILITY_QUICK');
  const resolvedLocation = resolveLocation(location) || location;
  const count            = await Complaint.countDocuments();
  const complaintId      = `JPMC-CMP-${1001 + count}`;

  const complaint = await Complaint.create({
    complaint_id:    complaintId,
    complaint_type:  'FACILITY_QUICK',
    description,
    location:        resolvedLocation,
    severity:        'HIGH',
    assigned_team:   typeObj.assigned_team,
    sla_hours:       typeObj.sla_hours,
    quick_resolution: true,
    employee_sid:    employee?.sid   || 'UNKNOWN',
    employee_name:   employee?.name  || 'Unknown Employee',
    phone_number:    phone           || 'Unknown',
    status:          'PENDING'
  });

  console.log(`🔧 Facility complaint: ${complaintId} at ${resolvedLocation} by ${employee?.name}`);
  sendComplaintEmail(employee, complaint);

  return vapiResponse(res, toolCallId,
    `Facility complaint ${complaintId} logged for ${resolvedLocation}. ` +
    `The Facilities Management team will send someone to check within ${typeObj.sla_hours} hours. ` +
    `I have flagged this for quick resolution.`
  );
});

// ─────────────────────────────────────────────
// TOOL: Report a person for bad behaviour / misconduct
// ─────────────────────────────────────────────
router.post('/report-person', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { description, reported_person, incident_location, is_staff } = args;

  if (!description) {
    return vapiResponse(res, toolCallId,
      'To file a behaviour report, please describe what happened. You can also mention the name or designation of the person involved if you know it.');
  }

  const typeId   = is_staff ? 'STAFF_BEHAVIOUR' : 'PERSON_REPORT';
  const typeObj  = complaintsData.complaint_types.find(t => t.id === typeId);
  const count    = await Complaint.countDocuments();
  const complaintId = `JPMC-CMP-${1001 + count}`;

  const complaint = await Complaint.create({
    complaint_id:    complaintId,
    complaint_type:  typeId,
    description,
    location:        incident_location || 'Not specified',
    reported_person: reported_person   || 'Not specified',
    severity:        typeObj.priority,
    assigned_team:   typeObj.assigned_team,
    sla_hours:       typeObj.sla_hours,
    quick_resolution: false,
    employee_sid:    employee?.sid   || 'UNKNOWN',
    employee_name:   employee?.name  || 'Unknown Employee',
    phone_number:    phone           || 'Unknown',
    status:          'PENDING'
  });

  console.log(`👤 Behaviour report: ${complaintId} against "${reported_person}" by ${employee?.name}`);
  sendComplaintEmail(employee, complaint);

  return vapiResponse(res, toolCallId,
    `Your complaint ${complaintId} has been submitted confidentially to ${typeObj.assigned_team}. ` +
    `It will be investigated within ${typeObj.sla_hours} hours. ` +
    `Your identity is protected throughout this process.`
  );
});

// ─────────────────────────────────────────────
// TOOL: Report food quality issue at an outlet
// ─────────────────────────────────────────────
router.post('/report-food', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { description, outlet_name, location } = args;

  if (!description) {
    return vapiResponse(res, toolCallId,
      'Please describe the food quality issue. For example: "The biryani at Tower A cafeteria was stale and had a bad smell."');
  }

  const typeObj     = complaintsData.complaint_types.find(t => t.id === 'FOOD_QUALITY');
  const count       = await Complaint.countDocuments();
  const complaintId = `JPMC-CMP-${1001 + count}`;

  const complaint = await Complaint.create({
    complaint_id:    complaintId,
    complaint_type:  'FOOD_QUALITY',
    description,
    location:        outlet_name || location || 'Not specified',
    severity:        'HIGH',
    assigned_team:   typeObj.assigned_team,
    sla_hours:       typeObj.sla_hours,
    quick_resolution: true,
    employee_sid:    employee?.sid   || 'UNKNOWN',
    employee_name:   employee?.name  || 'Unknown Employee',
    phone_number:    phone           || 'Unknown',
    status:          'PENDING'
  });

  console.log(`🍽️  Food quality report: ${complaintId} at "${outlet_name}" by ${employee?.name}`);
  sendComplaintEmail(employee, complaint);

  return vapiResponse(res, toolCallId,
    `Food quality complaint ${complaintId} filed for ${outlet_name || location || 'the outlet'}. ` +
    `The Cafeteria and Vendor Management team has been alerted. ` +
    `They will inspect and respond within ${typeObj.sla_hours} hours.`
  );
});

// ─────────────────────────────────────────────
// TOOL: Check status of a complaint
// ─────────────────────────────────────────────
router.post('/check', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const { complaint_id } = args;

  if (!complaint_id) {
    return vapiResponse(res, toolCallId, 'Please provide your complaint ID, for example JPMC-CMP-1001.');
  }

  const comp = await Complaint.findOne({ complaint_id: new RegExp(`^${complaint_id}$`, 'i') });
  if (!comp) {
    return vapiResponse(res, toolCallId, `I could not find complaint ${complaint_id}. Please check the ID and try again.`);
  }

  const typeLabel = complaintsData.complaint_types.find(t => t.id === comp.complaint_type)?.label || comp.complaint_type;

  return vapiResponse(res, toolCallId,
    `Complaint ${comp.complaint_id} — Type: ${typeLabel}. ` +
    `Status: ${comp.status}. ` +
    `Assigned to: ${comp.assigned_team}. ` +
    `${comp.status === 'RESOLVED' ? `Resolved on ${new Date(comp.resolved_at).toLocaleDateString('en-IN')}.` : `Expected resolution within ${comp.sla_hours} hours of filing.`}`
  );
});

// ─────────────────────────────────────────────
// TOOL: List my complaints
// ─────────────────────────────────────────────
router.post('/my-complaints', async (req, res) => {
  const toolCallId  = getToolCallId(req);
  const phone       = getCallerPhone(req);
  const employee    = getEmployeeByPhone(phone);
  const employeeSid = employee?.sid || null;

  const query = employeeSid ? { employee_sid: employeeSid } : {};
  const myComplaints = await Complaint.find(query).sort({ raised_at: -1 }).limit(10);

  if (myComplaints.length === 0) {
    return vapiResponse(res, toolCallId, 'You have not raised any complaints so far.');
  }

  const summary = myComplaints.map(c => {
    const label = complaintsData.complaint_types.find(t => t.id === c.complaint_type)?.label || c.complaint_type;
    return `${c.complaint_id}: ${label} — ${c.status}`;
  }).join('. ');

  return vapiResponse(res, toolCallId,
    `You have ${myComplaints.length} complaint(s). ${summary}.`
  );
});

// ─────────────────────────────────────────────
// TOOL: Get complaint categories (for agent/user info)
// ─────────────────────────────────────────────
router.post('/categories', (req, res) => {
  const toolCallId = getToolCallId(req);
  const categories = complaintsData.complaint_types
    .filter(t => t.id !== 'OTHER')
    .map(t => `${t.label} (SLA: ${t.sla_hours}h)`);

  return vapiResponse(res, toolCallId,
    `You can raise complaints for: ${categories.join('; ')}. ` +
    `All complaints are tracked and routed to the right team automatically.`
  );
});

// ─────────────────────────────────────────────
// REST: Resolve a complaint (admin/dashboard use)
// ─────────────────────────────────────────────
router.post('/resolve', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const { complaint_id, resolution_notes } = args;

  if (!complaint_id) return vapiResponse(res, toolCallId, 'Provide a complaint ID to resolve.');

  const comp = await Complaint.findOne({ complaint_id });
  if (!comp) return vapiResponse(res, toolCallId, `Complaint ${complaint_id} not found.`);

  comp.status      = 'RESOLVED';
  comp.resolved_at = new Date();
  await comp.save();

  return vapiResponse(res, toolCallId,
    `Complaint ${complaint_id} has been marked RESOLVED. Notes: ${resolution_notes || 'None'}.`
  );
});

// ─────────────────────────────────────────────
// REST GET: List all complaints (dashboard)
// ─────────────────────────────────────────────
router.get('/all', async (req, res) => {
  const { status, type, limit = 50 } = req.query;
  const query = {};
  if (status) query.status = status;
  if (type)   query.complaint_type = type;
  const complaints = await Complaint.find(query).sort({ raised_at: -1 }).limit(Number(limit));
  res.json(complaints);
});

module.exports = router;
