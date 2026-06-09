require('dotenv').config();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const SERVER_URL = process.env.SERVER_URL; // your ngrok URL

async function createITHelpdeskAssistant() {
  console.log('🤖 Creating vAPI IT Helpdesk Assistant...');

  const assistantConfig = {
    name: "JPMC IT Helpdesk Assistant",

    // The AI's personality and instructions
    model: {
      provider: "openai",
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are Alex, a smart and friendly assistant for JPMC employees.
You help with IT Helpdesk issues AND Meeting Room reservations over a phone call.

CRITICAL RULES:
- Caller is already verified — never ask for name or employee ID
- Keep every response under 3 sentences — this is a phone call
- Be warm, confident, and efficient

FOR IT ISSUES:
- Ask what the problem is
- Immediately raise a ticket using raise_ticket
- Confirm ticket ID and which team will handle it

FOR MEETING ROOMS:
- Ask: how many people, which date, what time
- Call check_room_availability to find options
- Suggest the best room and ask for confirmation
- Only call book_room AFTER the user says yes
- Always confirm booking ID at the end

FOR CANCELLATIONS:
- Ask for the booking ID
- Call cancel_booking to cancel it

FOR LISTING BOOKINGS:
- Call my_bookings to list their upcoming rooms

HANDLING DATES AND TIMES:
- Today's date is ${new Date().toISOString().split('T')[0]}
- If user says "tomorrow", calculate the correct date
- If user says "3pm", convert to 15:00
- Always confirm the date and time back to the user before booking

If any tool fails, say:
"I am having trouble with the system right now. Please visit the facilities desk or call extension 1234."

Never say "there is an issue with the system" — always offer an alternative.`
        }
      ],

      // Tools vAPI can call on your server
      tools: [
        {
          type: "function",
          function: {
            name: "raise_ticket",
            description: "Raise a new IT support ticket when employee describes an issue",
            parameters: {
              type: "object",
              properties: {
                employee_sid: {
                  type: "string",
                  description: "The employee's SID/ID"
                },
                employee_name: {
                  type: "string",
                  description: "The employee's full name"
                },
                phone_number: {
                  type: "string",
                  description: "The employee's phone number"
                },
                issue_description: {
                  type: "string",
                  description: "Description of the IT issue in the employee's words"
                }
              },
              required: ["employee_sid", "issue_description"]
            }
          },
          // Where vAPI sends the tool call
          server: {
            url: `${SERVER_URL}/helpdesk/raise-ticket`
          }
        },
        {
          type: "function",
          function: {
            name: "check_ticket",
            description: "Check the status of an existing IT ticket",
            parameters: {
              type: "object",
              properties: {
                ticket_id: {
                  type: "string",
                  description: "The ticket ID like JPMC-IT-1001"
                }
              },
              required: ["ticket_id"]
            }
          },
          server: {
            url: `${SERVER_URL}/helpdesk/check-ticket`
          }
        },
        {
          type: "function",
          function: {
            name: "my_tickets",
            description: "List all tickets raised by the employee",
            parameters: {
              type: "object",
              properties: {
                employee_sid: {
                  type: "string",
                  description: "The employee's SID/ID"
                }
              },
              required: ["employee_sid"]
            }
          },
          server: {
            url: `${SERVER_URL}/helpdesk/my-tickets`
          }
        },
        // ── Meeting Room Tools ──
{
  type: "function",
  function: {
    name: "check_room_availability",
    description: "Check which meeting rooms are available for a given date, time and number of people",
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format, e.g. 2026-06-10"
        },
        start_time: {
          type: "string",
          description: "Start time in HH:MM 24hr format, e.g. 14:00 for 2pm"
        },
        capacity_needed: {
          type: "number",
          description: "Number of people who need to attend"
        }
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
    description: "Book a specific meeting room after the user confirms they want it",
    parameters: {
      type: "object",
      properties: {
        room_name: {
          type: "string",
          description: "Name of the room to book, e.g. Aqua, Horizon, Zenith"
        },
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format"
        },
        start_time: {
          type: "string",
          description: "Start time in HH:MM 24hr format"
        },
        duration_hours: {
          type: "number",
          description: "Duration of the meeting in hours, default is 1"
        },
        agenda: {
          type: "string",
          description: "Brief agenda or purpose of the meeting"
        }
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
    description: "Cancel an existing room booking using the booking ID",
    parameters: {
      type: "object",
      properties: {
        booking_id: {
          type: "string",
          description: "The booking ID like JPMC-RM-2001"
        }
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
    parameters: {
      type: "object",
      properties: {},
      required: []
    }
  },
  server: { url: `${SERVER_URL}/meetingroom/my-bookings` }
},
      ]
    },

    // Voice settings
    voice: {
        provider: "11labs",
        voiceId: "burt"
    },

    // Call settings
    firstMessage: "Hello! I'm Alex from the JPMC IT Helpdesk. How can I help you today?",
    endCallMessage: "Your issue has been noted. Have a great day!",

    // End call if user says bye/thanks
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
      console.log('👉 Copy this ID and add it to your .env as VAPI_ASSISTANT_ID');
    } else {
      console.log('❌ Error creating assistant:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('❌ Failed to create assistant:', err.message);
  }
}

createITHelpdeskAssistant();