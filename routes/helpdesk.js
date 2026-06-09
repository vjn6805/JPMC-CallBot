const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const employees = require('../employees.json');

const TICKETS_PATH = path.join(__dirname, '../data/tickets.json');
const ISSUES_PATH = path.join(__dirname, '../data/it_issues.json');

function getEmployeeByPhone(phoneNumber) {
  if (!phoneNumber) return null;
  return employees[phoneNumber] || null;
}

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function detectCategory(description) {
  const { categories } = readJSON(ISSUES_PATH);
  const lowerDesc = description.toLowerCase();
  for (const category of categories) {
    for (const keyword of category.keywords) {
      if (lowerDesc.includes(keyword)) return category;
    }
  }
  return categories.find(c => c.id === 'OTHER');
}

// ─────────────────────────────────────────────
// KEY FIX: extract args from vAPI's format
// vAPI wraps arguments inside message.toolCallList
// ─────────────────────────────────────────────
function extractArgs(req) {
  try {
    // vAPI format
    if (req.body?.message?.toolCallList?.[0]?.function?.arguments) {
      const args = req.body.message.toolCallList[0].function.arguments;
      return typeof args === 'string' ? JSON.parse(args) : args;
    }
    // vAPI alternative format
    if (req.body?.message?.toolCalls?.[0]?.function?.arguments) {
      const args = req.body.message.toolCalls[0].function.arguments;
      return typeof args === 'string' ? JSON.parse(args) : args;
    }
    // Direct format (curl testing)
    return req.body;
  } catch (e) {
    return req.body;
  }
}

// ─────────────────────────────────────────────
// vAPI expects this exact response shape
// ─────────────────────────────────────────────
function vapiResponse(res, toolCallId, resultText) {
  // Try to get toolCallId from request if not passed
  return res.json({
    results: [
      {
        toolCallId: toolCallId || 'unknown',
        result: resultText
      }
    ]
  });
}

// ─────────────────────────────────────────────
// TOOL 0: Get quick fix suggestions
// Called before raising a ticket — tries to
// resolve the issue with self-service steps
// ─────────────────────────────────────────────
router.post('/get-quick-fix', (req, res) => {
  console.log('📥 get-quick-fix');

  const args = extractArgs(req);
  const toolCallId = req.body?.message?.toolCallList?.[0]?.id
    || req.body?.message?.toolCalls?.[0]?.id
    || 'tool-call-1';

  const { issue_description } = args;

  if (!issue_description) {
    return vapiResponse(res, toolCallId,
      'Could you describe your issue so I can suggest a fix?'
    );
  }

  const category = detectCategory(issue_description);
  const fixes = category.quick_fixes || [];

  if (!fixes.length || category.id === 'OTHER') {
    return vapiResponse(res, toolCallId,
      `NO_QUICK_FIX. Category is ${category.label}.`
    );
  }

  // Return fixes as numbered steps with human-like pacing cues
  const steps = fixes.slice(0, 2);
  const stepText = steps
    .map((fix, i) => `Step ${i + 1}: ${fix}`)
    .join(' ... ');

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
router.post('/raise-ticket', (req, res) => {
  console.log('📥 raise-ticket body:', JSON.stringify(req.body, null, 2));

  const args = extractArgs(req);
  const toolCallId = req.body?.message?.toolCallList?.[0]?.id
    || req.body?.message?.toolCalls?.[0]?.id
    || 'tool-call-1';

  const { issue_description } = args;

  if (!issue_description) {
    return vapiResponse(res, toolCallId,
      'I could not understand the issue. Could you describe your problem again?'
    );
  }

  // ── Look up employee from phone number (most reliable source) ──
  const callerPhone = req.body?.message?.call?.customer?.number
    || req.body?.message?.customer?.number
    || null;

  console.log(`📞 Caller phone from vAPI: ${callerPhone}`);

  const employee = getEmployeeByPhone(callerPhone);

  const employeeSid  = employee?.sid        || args.employee_sid  || 'UNKNOWN';
  const employeeName = employee?.name       || args.employee_name || 'Unknown Employee';
  const department   = employee?.department || 'Unknown';
  const phoneNumber  = callerPhone          || 'Unknown';

  console.log(`👤 Resolved employee: ${employeeName} (${employeeSid})`);

  // ── Create the ticket ──
  const ticketsData = readJSON(TICKETS_PATH);
  const category = detectCategory(issue_description);
  const newTicketId = ticketsData.last_ticket_id + 1;

  const newTicket = {
    ticket_id: `JPMC-IT-${newTicketId}`,
    employee_sid: employeeSid,
    employee_name: employeeName,
    department: department,
    phone_number: phoneNumber,
    issue_description,
    category: category.label,
    category_id: category.id,
    assigned_team: category.team,
    sla_hours: category.sla_hours,
    status: 'OPEN',
    raised_at: new Date().toISOString(),
    resolved_at: null
  };

  ticketsData.tickets.push(newTicket);
  ticketsData.last_ticket_id = newTicketId;
  writeJSON(TICKETS_PATH, ticketsData);

  console.log(`🎫 Ticket raised: ${newTicket.ticket_id} for ${employeeName}`);

  return vapiResponse(res, toolCallId,
    `Ticket ${newTicket.ticket_id} has been raised for ${employeeName}. ` +
    `The ${category.team} will contact you within ${category.sla_hours} hours. ` +
    `Your ticket ID is ${newTicket.ticket_id}.`
  );
});

// ─────────────────────────────────────────────
// TOOL 2: Check ticket status
// ─────────────────────────────────────────────
router.post('/check-ticket', (req, res) => {
  console.log('📥 check-ticket body:', JSON.stringify(req.body, null, 2));

  const args = extractArgs(req);
  const toolCallId = req.body?.message?.toolCallList?.[0]?.id
    || req.body?.message?.toolCalls?.[0]?.id
    || 'tool-call-1';

  const { ticket_id } = args;

  if (!ticket_id) {
    return vapiResponse(res, toolCallId,
      'Please provide a ticket ID so I can check its status.'
    );
  }

  const ticketsData = readJSON(TICKETS_PATH);
  const ticket = ticketsData.tickets.find(
    t => t.ticket_id.toLowerCase() === ticket_id.toLowerCase()
  );

  if (!ticket) {
    return vapiResponse(res, toolCallId,
      `I could not find ticket ${ticket_id}. Please check the ID and try again.`
    );
  }

  return vapiResponse(res, toolCallId,
    `Ticket ${ticket.ticket_id} is currently ${ticket.status}. ` +
    `It is assigned to ${ticket.assigned_team}. ` +
    `Issue: ${ticket.issue_description}.`
  );
});

// ─────────────────────────────────────────────
// TOOL 3: List my tickets
// ─────────────────────────────────────────────
router.post('/my-tickets', (req, res) => {
  const args = extractArgs(req);
  const toolCallId = req.body?.message?.toolCallList?.[0]?.id
    || req.body?.message?.toolCalls?.[0]?.id
    || 'tool-call-1';

  // Look up employee from phone number
  const callerPhone = req.body?.message?.call?.customer?.number
    || req.body?.message?.customer?.number
    || null;

  const employee = getEmployeeByPhone(callerPhone);
  const employeeSid = employee?.sid || args.employee_sid || null;

  const ticketsData = readJSON(TICKETS_PATH);

  const myTickets = employeeSid
    ? ticketsData.tickets.filter(t => t.employee_sid === employeeSid).slice(-5)
    : ticketsData.tickets.slice(-5);

  if (myTickets.length === 0) {
    return vapiResponse(res, toolCallId, 'You have no tickets raised so far.');
  }

  const summary = myTickets
    .map(t => `${t.ticket_id}: ${t.category} is ${t.status}`)
    .join('. ');

  return vapiResponse(res, toolCallId,
    `You have ${myTickets.length} ticket(s). ${summary}.`
  );
});

module.exports = router;