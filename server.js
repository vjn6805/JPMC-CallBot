require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

// ─────────────────────────────────────────────
// MongoDB connection
// ─────────────────────────────────────────────
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('🍏 MongoDB connected'))
  .catch(err => console.error('❌ MongoDB connection failed:', err.message));

// ─────────────────────────────────────────────
// Auto-create data files if missing (needed on
// fresh Render deploys since they are gitignored)
// ─────────────────────────────────────────────
const dataDefaults = {
  'data/tickets.json':         JSON.stringify({ tickets: [], last_ticket_id: 1000 }, null, 2),
  'data/food-orders.json':     JSON.stringify({ orders: [], last_order_id: 3000 }, null, 2),
  'data/shuttle-bookings.json':JSON.stringify({ bookings: [], last_booking_id: 5000 }, null, 2),
  'data/bookings.json':        JSON.stringify({ bookings: [], last_booking_id: 2000 }, null, 2)
};
for (const [filePath, defaultContent] of Object.entries(dataDefaults)) {
  const fullPath = path.join(__dirname, filePath);
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, defaultContent);
    console.log(`📁 Created missing data file: ${filePath}`);
  }
}



app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));



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

const ragRoutes = require('./routes/rag');
app.use('/rag', ragRoutes);

const foodRoutes = require('./routes/food');
app.use('/food', foodRoutes);

const shuttleRoutes = require('./routes/shuttle');
app.use('/shuttle', shuttleRoutes);

const complaintsRoutes = require('./routes/complaints');
app.use('/complaints', complaintsRoutes);

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

// ─────────────────────────────────────────────
// OUTBOUND CALL: frontend button triggers this
// Twilio calls the user, then connects to vAPI
// ─────────────────────────────────────────────
const twilio = require('twilio');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

app.post('/call/outbound', async (req, res) => {
  const { to } = req.body;

  if (!to) return res.status(400).json({ success: false, error: 'Phone number required' });

  const employee = employees[to];
  if (!employee) {
    return res.status(403).json({ success: false, error: 'This number is not registered with JPMC.' });
  }

  try {
    // Use vAPI outbound call API directly — most reliable method
    const response = await fetch('https://api.vapi.ai/call/phone', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        assistantId: process.env.VAPI_ASSISTANT_ID,
        assistantOverrides: {
          firstMessage: `Hello ${employee.name}! I am Alex from JPMC. Your identity has been verified. How can I help you today?`
        },
        phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID,
        customer: { number: to }
      })
    });

    const data = await response.json();

    if (data.id) {
      console.log(`📞 vAPI outbound call to ${to}: ${data.id}`);
      res.json({ success: true, call_id: data.id });
    } else {
      throw new Error(data.message || JSON.stringify(data));
    }
  } catch (err) {
    console.error('Outbound call failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// TwiML for outbound call — connects to vAPI the same way as inbound
app.post('/call/twiml', (req, res) => {
  const vapiAssistantId = process.env.VAPI_ASSISTANT_ID;
  const to = req.query.to || req.body.To;
  const employee = employees[to] || {};

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <SipUri>sip:${vapiAssistantId}@sip.vapi.ai;transport=tcp</SipUri>
  </Dial>
</Response>`;

  res.type('text/xml').send(twiml);
});


// Use these to build your dashboard / frontend
// ─────────────────────────────────────────────
const { Ticket, RoomBooking, FoodOrder, ShuttleBooking, Complaint } = require('./models');

app.get('/api/tickets',          async (req, res) => { res.json(await Ticket.find().sort({ raised_at: -1 })); });
app.get('/api/room-bookings',    async (req, res) => { res.json(await RoomBooking.find().sort({ booked_at: -1 })); });
app.get('/api/food-orders',      async (req, res) => { res.json(await FoodOrder.find().sort({ ordered_at: -1 })); });
app.get('/api/shuttle-bookings', async (req, res) => { res.json(await ShuttleBooking.find().sort({ booked_at: -1 })); });
app.get('/api/complaints',       async (req, res) => { res.json(await Complaint.find().sort({ raised_at: -1 })); });

// Summary endpoint — useful for dashboard
app.get('/api/summary', async (req, res) => {
  const [tickets, rooms, food, shuttles, complaints] = await Promise.all([
    Ticket.countDocuments({ status: 'OPEN' }),
    RoomBooking.countDocuments({ status: 'CONFIRMED' }),
    FoodOrder.countDocuments({ status: 'PENDING_PAYMENT' }),
    ShuttleBooking.countDocuments({ status: 'CONFIRMED' }),
    Complaint.countDocuments({ status: 'PENDING' })
  ]);
  res.json({ open_tickets: tickets, active_room_bookings: rooms, pending_food_orders: food, shuttle_bookings: shuttles, pending_complaints: complaints });
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