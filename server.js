require('dotenv').config();
const express = require('express');
const app = express();



app.use(express.urlencoded({ extended: false }));
app.use(express.json());



const employees = require('./employees.json');

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