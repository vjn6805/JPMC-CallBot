const express = require('express');
const router = express.Router();
const path = require('path');
const { Ticket, Complaint } = require('../models');
const employees = require('../employees.json');
const itIssues  = require('../data/it_issues.json');
const { sendTicketEmail, sendComplaintEmail } = require('../utils/email');

function getEmployeeByPhone(phone) { return phone ? (employees[phone] || null) : null; }

function detectCategory(description) {
  const lowerDesc = description.toLowerCase();
  for (const category of itIssues.categories) {
    for (const keyword of category.keywords) {
      if (lowerDesc.includes(keyword)) return category;
    }
  }
  return itIssues.categories.find(c => c.id === 'OTHER');
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

// ─────────────────────────────────────────────
// TOOL 0: Get quick fix suggestions
// ─────────────────────────────────────────────
router.post('/get-quick-fix', (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const { issue_description } = args;

  if (!issue_description) {
    return vapiResponse(res, toolCallId, 'Could you describe your issue so I can suggest a fix?');
  }

  const category = detectCategory(issue_description);
  const fixes = category.quick_fixes || [];

  if (!fixes.length || category.id === 'OTHER') {
    return vapiResponse(res, toolCallId, `NO_QUICK_FIX. Category is ${category.label}.`);
  }

  const steps = fixes.slice(0, 2);
  const stepText = steps.map((fix, i) => `Step ${i + 1}: ${fix}`).join(' ... ');

  return vapiResponse(res, toolCallId,
    `QUICK_FIX_AVAILABLE. Category: ${category.label}. ` +
    `Okay, let me walk you through this one step at a time. ... ${stepText} ... ` +
    `Take your time with each step, and let me know once you have tried that. ... ` +
    `ASK_USER: Did that resolve your issue, or would you like me to raise a support ticket?`
  );
});

// ─────────────────────────────────────────────
// TOOL 1: Raise a new IT ticket
// ─────────────────────────────────────────────
router.post('/raise-ticket', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const { issue_description } = args;

  if (!issue_description) {
    return vapiResponse(res, toolCallId, 'I could not understand the issue. Could you describe your problem again?');
  }

  const category     = detectCategory(issue_description);
  const employeeSid  = employee?.sid        || 'UNKNOWN';
  const employeeName = employee?.name       || 'Unknown Employee';
  const department   = employee?.department || 'Unknown';

  const count    = await Ticket.countDocuments();
  const ticketId = `JPMC-IT-${1001 + count}`;

  const ticket = await Ticket.create({
    ticket_id:         ticketId,
    employee_sid:      employeeSid,
    employee_name:     employeeName,
    department,
    phone_number:      phone || 'Unknown',
    issue_description,
    category:          category.label,
    category_id:       category.id,
    assigned_team:     category.team,
    sla_hours:         category.sla_hours,
    status:            'OPEN'
  });

  console.log(`🎫 Ticket raised: ${ticket.ticket_id} for ${employeeName}`);

  // Send confirmation email
  sendTicketEmail(employee, ticket, category);

  return vapiResponse(res, toolCallId,
    `Ticket ${ticket.ticket_id} has been raised. ` +
    `The ${category.team} will contact you within ${category.sla_hours} hours. ` +
    `Your ticket ID is ${ticket.ticket_id}.`
  );
});

// ─────────────────────────────────────────────
// TOOL 2: Check ticket status
// ─────────────────────────────────────────────
router.post('/check-ticket', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const { ticket_id } = args;

  if (!ticket_id) {
    return vapiResponse(res, toolCallId, 'Please provide a ticket ID so I can check its status.');
  }

  const ticket = await Ticket.findOne({ ticket_id: new RegExp(`^${ticket_id}$`, 'i') });

  if (!ticket) {
    return vapiResponse(res, toolCallId, `I could not find ticket ${ticket_id}. Please check the ID and try again.`);
  }

  return vapiResponse(res, toolCallId,
    `Ticket ${ticket.ticket_id} is currently ${ticket.status}. ` +
    `It is assigned to ${ticket.assigned_team}. Issue: ${ticket.issue_description}.`
  );
});

// ─────────────────────────────────────────────
// TOOL 3: List my tickets
// ─────────────────────────────────────────────
router.post('/my-tickets', async (req, res) => {
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const employeeSid = employee?.sid || null;

  const query = employeeSid ? { employee_sid: employeeSid } : {};
  const myTickets = await Ticket.find(query).sort({ raised_at: -1 }).limit(5);

  if (myTickets.length === 0) {
    return vapiResponse(res, toolCallId, 'You have no tickets raised so far.');
  }

  const summary = myTickets.map(t => `${t.ticket_id}: ${t.category} is ${t.status}`).join('. ');
  return vapiResponse(res, toolCallId, `You have ${myTickets.length} ticket(s). ${summary}.`);
});

// ─────────────────────────────────────────────
// TOOL 4: Raise a complaint (quick resolution, person report, food quality, facility)
// ─────────────────────────────────────────────
router.post('/raise-complaint', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);

  const { description, complaint_type, location, outlet_id, reported_person, quick_resolution } = args;

  if (!description || !complaint_type) {
    return vapiResponse(res, toolCallId, 'I need the complaint description and type to proceed. Examples: QUICK_FIX, PERSON_REPORT, FOOD_QUALITY, FACILITY.');
  }

  const count = await Complaint.countDocuments();
  const complaintId = `JPMC-CMP-${1001 + count}`;

  const complaint = await Complaint.create({
    complaint_id: complaintId,
    complaint_type,
    description,
    location,
    outlet_id,
    reported_person,
    quick_resolution: !!quick_resolution,
    employee_sid: employee?.sid || 'UNKNOWN',
    employee_name: employee?.name || 'Unknown',
    phone_number: phone || 'Unknown',
    status: quick_resolution ? 'PENDING' : 'PENDING'
  });

  console.log(`⚠️ Complaint raised: ${complaint.complaint_id} by ${employee?.name}`);

  // Send confirmation email to user
  sendComplaintEmail(employee, complaint);

  let responseText = `Complaint ${complaint.complaint_id} received. We will act on this shortly.`;
  if (quick_resolution) {
    responseText = `QUICK_RESOLUTION_REQUESTED. Complaint ${complaint.complaint_id} is flagged for quick resolution. Maintenance or floor staff will check ${location || 'the area'} right away.`;
  }

  return vapiResponse(res, toolCallId, responseText);
});

// ─────────────────────────────────────────────
// TOOL 5: Resolve a complaint (used by staff or admin)
// ─────────────────────────────────────────────
router.post('/resolve-complaint', async (req, res) => {
  const args       = extractArgs(req);
  const toolCallId = getToolCallId(req);
  const { complaint_id, resolution_notes } = args;

  if (!complaint_id) return vapiResponse(res, toolCallId, 'Please provide a complaint ID to resolve.');

  const comp = await Complaint.findOne({ complaint_id });
  if (!comp) return vapiResponse(res, toolCallId, `I could not find complaint ${complaint_id}.`);

  comp.status = 'RESOLVED';
  comp.resolved_at = new Date();
  await comp.save();

  return vapiResponse(res, toolCallId, `Complaint ${complaint_id} has been marked RESOLVED. Notes: ${resolution_notes || 'None'}`);
});

// ─────────────────────────────────────────────
// TOOL 6: List my complaints
// ─────────────────────────────────────────────
router.post('/my-complaints', async (req, res) => {
  const toolCallId = getToolCallId(req);
  const phone      = getCallerPhone(req);
  const employee   = getEmployeeByPhone(phone);
  const employeeSid = employee?.sid || null;

  const query = employeeSid ? { employee_sid: employeeSid } : {};
  const myComplaints = await Complaint.find(query).sort({ raised_at: -1 }).limit(10);

  if (myComplaints.length === 0) {
    return vapiResponse(res, toolCallId, 'You have no complaints registered so far.');
  }

  const summary = myComplaints.map(c => `${c.complaint_id}: ${c.complaint_type} is ${c.status}`).join('. ');
  return vapiResponse(res, toolCallId, `You have ${myComplaints.length} complaint(s). ${summary}.`);
});

module.exports = router;
