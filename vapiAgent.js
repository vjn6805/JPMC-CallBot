require('dotenv').config();

const VAPI_API_KEY = process.env.VAPI_API_KEY;
const SERVER_URL = process.env.SERVER_URL;

async function createAssistant() {
  console.log('🤖 Creating vAPI JPMC Assistant...');

  const assistantConfig = {
    name: "JPMC Employee Assistant",

    server: {
      url: `${SERVER_URL}/vapi/auth-hook`
    },

    model: {
      provider: "openai",
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `You are Alex, a JPMC employee assistant for IT Helpdesk, Meeting Room reservations, and company knowledge.

The caller has already been verified. Do NOT ask for name or employee ID.

FOR IT ISSUES — follow this exact flow:
1. Listen to the employee's problem
2. Call get_quick_fix with their issue description
3. If result contains "QUICK_FIX_AVAILABLE":
   - Say "Okay, let me help you fix this. I will go step by step, so take your time."
   - Read ONLY Step 1 first. Then say "Let me know when you have done that."
   - Wait for user to respond before moving to Step 2
   - After Step 2, ask "Did that resolve your issue, or shall I raise a support ticket?"
   - If YES resolved → "Great, glad that worked! Is there anything else I can help you with?"
   - If NO / still broken → call raise_ticket and confirm the ticket ID and team
4. If result contains "NO_QUICK_FIX": go straight to raise_ticket
5. Never raise a ticket without trying get_quick_fix first
6. Never read all steps at once — always one step at a time, wait for confirmation

FOR COMPANY KNOWLEDGE / POLICY QUESTIONS:
- Any question about HR, leave, WFH, onboarding, tools, benefits, insurance, bonus, git, deployment, compliance → call search_knowledge_base
- Always cite the source: "According to the JPMC HR Policy..."
- After answering, mention 1-2 related things they might want to know
- If user asks what you can help with → call list_knowledge_topics

FOR MEETING ROOMS:
- Ask: how many people, which date, what time
- Call check_room_availability → suggest best room → ask for confirmation
- Only call book_room AFTER user says yes → confirm booking ID

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
        // ── IT Helpdesk Tools ──
        {
          type: "function",
          function: {
            name: "get_quick_fix",
            description: "ALWAYS call this first when an employee reports an IT issue. Returns self-service fix steps to try before raising a ticket.",
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
          server: { url: `${SERVER_URL}/helpdesk/get-quick-fix` }
        },
        {
          type: "function",
          function: {
            name: "raise_ticket",
            description: "Raise a new IT support ticket. Only call this after get_quick_fix has been tried and the issue is not resolved.",
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
        // ── Meeting Room Tools ──
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
        },
        // ── Knowledge Base / Document RAG Tools ──
        {
          type: "function",
          function: {
            name: "search_knowledge_base",
            description: "Search JPMC internal documents to answer questions about HR policies, onboarding, engineering guidelines, employee benefits, compliance, leave, WFH, tools, insurance, bonus, git, deployment, and any other company policy questions.",
            parameters: {
              type: "object",
              properties: {
                query: {
                  type: "string",
                  description: "The employee's question in natural language"
                }
              },
              required: ["query"]
            }
          },
          server: { url: `${SERVER_URL}/rag/search` }
        },
        {
          type: "function",
          function: {
            name: "list_knowledge_topics",
            description: "List all topics available in the JPMC knowledge base. Call this when user asks what you can help with.",
            parameters: { type: "object", properties: {}, required: [] }
          },
          server: { url: `${SERVER_URL}/rag/topics` }
        }
      ]
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
