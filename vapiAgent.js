require('dotenv').config();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const SERVER_URL = process.env.SERVER_URL;

async function createAssistant() {
  console.log('🤖 Creating vAPI JPMC Assistant...');

  const assistantConfig = {
    name: "JPMC Employee Assistant",

    // ── SERVER WEBHOOK ──────────────────────────────────────────
    // vAPI calls this BEFORE the assistant says anything.
    // We return a custom firstMessage based on auth result.
    // This is infrastructure-level auth, not LLM-level.
    server: {
      url: `${SERVER_URL}/vapi/auth-hook`
    },

    model: {
      provider: "openai",
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are Alex, a JPMC employee assistant for IT Helpdesk and Meeting Room reservations.

The caller has already been verified by the system before this conversation started.
Their name and details are already confirmed — do NOT ask for name or employee ID.

FOR IT ISSUES:
- Ask what the problem is
- Call raise_ticket immediately after they describe it
- Confirm ticket ID and which team will handle it

FOR MEETING ROOMS:
- Ask: how many people, which date, what time
- Call check_room_availability
- Suggest best room, ask for confirmation
- Only call book_room AFTER user says yes
- Confirm booking ID at the end

FOR CANCELLATIONS: ask for booking/ticket ID → call the cancel tool
FOR LISTING: call my_bookings or my_tickets as appropriate

HANDLING DATES:
- Today is ${new Date().toISOString().split('T')[0]}
- Convert "tomorrow", "3pm" etc. to proper format before calling tools

RULES:
- Max 2-3 sentences per response — this is a phone call
- If a tool fails: "I'm having trouble right now. Please call extension 1234."`
        }
      ],

      tools: [
        {
          type: "function",
          function: {
            name: "raise_ticket",
            description: "Raise a new IT support ticket when employee describes an issue",
            parameters: {
              type: "object",
              properties: {
                issue_description: {
                  type: "string",
                  description: "Description of the IT issue in the employee's words"
                }
              },
              required: ["issue_description"]
            }
          },
          server: { url: `${SERVER_URL}/helpdesk/raise-ticket` }
        },
        {
          type: "function",
          function: {
            name: "check_ticket",
            description: "Check the status of an existing IT ticket",
            parameters: {
              type: "object",
              properties: {
                ticket_id: { type: "string", description: "The ticket ID like JPMC-IT-1001" }
              },
              required: ["ticket_id"]
            }
          },
          server: { url: `${SERVER_URL}/helpdesk/check-ticket` }
        },
        {
          type: "function",
          function: {
            name: "my_tickets",
            description: "List all tickets raised by the employee",
            parameters: { type: "object", properties: {}, required: [] }
          },
          server: { url: `${SERVER_URL}/helpdesk/my-tickets` }
        },
        {
          type: "function",
          function: {
            name: "check_room_availability",
            description: "Check which meeting rooms are available for a given date, time and number of people",
            parameters: {
              type: "object",
              properties: {
                date: { type: "string", description: "Date in YYYY-MM-DD format" },
                start_time: { type: "string", description: "Start time in HH:MM 24hr format" },
                capacity_needed: { type: "number", description: "Number of people attending" }
              },
              required: ["date", "start_time", "capacity_needed"]
            }
          },
          server: { url: `${SERVER_URL}/meetingroom/check-availability` }
        },
        {
          type: "function",
          function: {
            name: "book_room",
            description: "Book a specific meeting room after user confirms",
            parameters: {
              type: "object",
              properties: {
                room_name: { type: "string", description: "Name of the room e.g. Aqua, Horizon" },
                date: { type: "string", description: "Date in YYYY-MM-DD format" },
                start_time: { type: "string", description: "Start time in HH:MM 24hr format" },
                duration_hours: { type: "number", description: "Duration in hours, default 1" },
                agenda: { type: "string", description: "Brief agenda of the meeting" }
              },
              required: ["room_name", "date", "start_time"]
            }
          },
          server: { url: `${SERVER_URL}/meetingroom/book-room` }
        },
        {
          type: "function",
          function: {
            name: "cancel_booking",
            description: "Cancel an existing room booking",
            parameters: {
              type: "object",
              properties: {
                booking_id: { type: "string", description: "Booking ID like JPMC-RM-2001" }
              },
              required: ["booking_id"]
            }
          },
          server: { url: `${SERVER_URL}/meetingroom/cancel-booking` }
        },
        {
          type: "function",
          function: {
            name: "my_bookings",
            description: "List all upcoming room bookings for the caller",
            parameters: { type: "object", properties: {}, required: [] }
          },
          server: { url: `${SERVER_URL}/meetingroom/my-bookings` }
        }
      ]
    },

    voice: {
      provider: "11labs",
      voiceId: "burt"
    },

    voice: {
      provider: "11labs",
      voiceId: "burt"
    },

    firstMessage: "Hello! I'm Alex from JPMC. How can I help you today?",
    endCallMessage: "Thank you. Have a great day!",
    endCallPhrases: ["goodbye", "bye", "thank you bye", "that's all", "nothing else"]
  };

  try {
    const response = await fetch('https://api.vapi.ai/assistant', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(assistantConfig)
    });

    const data = await response.json();

    if (data.id) {
      console.log('✅ Assistant created successfully!');
      console.log(`📋 Assistant ID: ${data.id}`);
      console.log('👉 Add this to your .env as VAPI_ASSISTANT_ID');
    } else {
      console.log('❌ Error:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('❌ Failed:', err.message);
  }
}

createAssistant();
