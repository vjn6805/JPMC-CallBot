require('dotenv').config();
const express = require('express');
const app = express();



app.use(express.urlencoded({ extended: false }));
app.use(express.json());



const employees = require('./employees.json');

// ─────────────────────────────────────────────
// VAPI AUTH HOOK: called by vAPI at call start
// before assistant says anything.
// Verified   → return custom firstMessage with employee name
// Unverified → return endCall to block the call entirely
// ─────────────────────────────────────────────
app.post('/vapi/auth-hook', (req, res) => {
  const msgType = req.body?.message?.type;
  console.log(`🔐 vAPI hook received type: ${msgType}`);

  // "assistant-request" fires when vAPI needs to know which assistant to use
  // This is the correct gate — return assistant config with custom firstMessage
  if (msgType === 'assistant-request') {
    const phone = req.body?.message?.call?.customer?.number || null;
    console.log(`🔐 Auth check for: ${phone}`);

    const employee = phone ? employees[phone] : null;
    const vapiAssistantId = process.env.VAPI_ASSISTANT_ID;

    if (employee) {
      console.log(`✅ Verified: ${employee.name} (${employee.sid})`);
      return res.json({
        assistantId: vapiAssistantId,
        assistantOverrides: {
          firstMessage: `Hello ${employee.name}! I'm Alex from JPMC. Your identity has been verified. How can I help you today?`,
          variableValues: {
            employee_name: employee.name,
            employee_sid: employee.sid,
            employee_phone: phone
          }
        }
      });
    } else {
      console.log(`❌ Rejected unregistered number: ${phone}`);
      // Return a reject assistant inline — no assistantId means vAPI uses this config only
      return res.json({
        assistant: {
          firstMessage: "Sorry, your number is not registered with JPMC. Please contact HR to get access. Goodbye.",
          endCallPhrases: ["goodbye"],
          model: {
            provider: "openai",
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: "You only say one thing: the firstMessage. Then end the call." }]
          },
          voice: { provider: "11labs", voiceId: "burt" }
        }
      });
    }
  }

  // All other event types (end-of-call-report, etc.) — just acknowledge
  res.json({});
});

// ─────────────────────────────────────────────
// AUTH TOOL ROUTE (kept for legacy tool calls)
// ─────────────────────────────────────────────
app.post('/auth/verify', (req, res) => {
  const phone = req.body?.message?.call?.customer?.number
    || req.body?.phone_number || null;
  const toolCallId = req.body?.message?.toolCallList?.[0]?.id
    || req.body?.message?.toolCalls?.[0]?.id || 'tool-call-1';
  const employee = phone ? employees[phone] : null;
  if (employee) {
    return res.json({ results: [{ toolCallId, result: `VERIFIED. Name: ${employee.name}. SID: ${employee.sid}.` }] });
  }
  return res.json({ results: [{ toolCallId, result: `NOT_VERIFIED. End the call.` }] });
});

// Mount helpdesk routes
const helpdeskRoutes = require('./routes/helpdesk');
app.use('/helpdesk', helpdeskRoutes);

const meetingRoomRoutes = require('./routes/meetingroom');
app.use('/meetingroom', meetingRoomRoutes);

// ─────────────────────────────────────────────
// ROUTE 1: Twilio incoming call
// Phase 1 auth + hand off to vAPI
// ─────────────────────────────────────────────
app.post('/incoming-call', (req, res) => {
  const callerNumber = req.body.From;
  console.log(`📞 Incoming call from: ${callerNumber}`);

  const employee = employees[callerNumber];
  if (employee) {
    console.log(`✅ Authenticated: ${employee.name} (${employee.sid})`);

  const vapiAssistantId = process.env.VAPI_ASSISTANT_ID;

  // Encode employee data into the SIP URI as custom headers
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi" language="en-IN">
    Identity verified. Connecting you to your assistant.
  </Say>
  <Dial>
    <SipUri>sip:${vapiAssistantId}@sip.vapi.ai;transport=tcp;x-employeename=${encodeURIComponent(employee.name)};x-employeesid=${encodeURIComponent(employee.sid)};x-department=${encodeURIComponent(employee.department)}</SipUri>
  </Dial>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
  }
   else {
    console.log(`❌ Rejected: ${callerNumber}`);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Aditi" language="en-IN">
    Sorry, your number is not registered with JPMC. Please contact HR. Goodbye.
  </Say>
  <Hangup/>
</Response>`;

    res.type('text/xml');
    res.send(twiml);
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    phase: 2,
    features: ['authentication', 'it-helpdesk'],
    employees_loaded: Object.keys(employees).length
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});