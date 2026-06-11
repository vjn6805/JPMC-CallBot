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
          content: `You are Alex, a JPMC employee assistant for IT Helpdesk, Meeting Room reservations, Food Ordering, Shuttle Booking, Company Knowledge, and Complaints.

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

FOR SHUTTLE BOOKING:
- Call get_available_shuttles first with the travel date
- If result contains "NOT_REGISTERED" → tell them to register at go.jpmc.com/transport and end that topic
- If shuttles are available → read out options clearly one by one with departure time and pickup point
- After user picks an option → confirm the details and call book_shuttle
- For cancellation → ask for booking ID → call cancel_shuttle
- Remind user: bookings must be made 6 hours before departure, cancellations 1 hour before
- For listing bookings → call my_shuttle_bookings

FOR FOOD ORDERING:
- When user asks about food or cuisine → call search_food
- search_food returns outlet_id and item_ids in the response — remember these
- Read out the items and prices naturally to the user
- Ask what they want to order
- When user says what they want → call order_by_name with the outlet_id from search and the item names they said
- order_by_name returns a confirmation summary with CONFIRM_ORDER — read it to the user and ask them to confirm
- ONLY after user says YES → call place_food_order with the outlet_id and item_ids from the CONFIRM_ORDER response
- After order placed → tell them order ID and that SMS with payment link is sent
- Never place an order without user saying yes

FOR MEETING ROOMS AND FOCUS ROOMS:
- When user says "focus room" or "quiet room" or "solo room" → book a focus room (type: focus)
- When user says "meeting room" or mentions multiple people → book a meeting room (type: meeting)
- Ask: how many people, which date, what time, which building (default to their building)
- Call check_room_availability → suggest best room → ask for confirmation
- Only call book_room AFTER user says yes → confirm booking ID

FOR CANCELLATIONS: ask for booking/ticket ID → call the cancel tool
FOR LISTING: call my_bookings or my_tickets as appropriate

FOR COMPLAINTS & FACILITY ISSUES (SEPARATE FROM IT HELPDESK):
This is a SEPARATE system from IT — do NOT use raise_ticket for complaints.

COMPLAINT TYPES you can handle:
- Facility Quick Fix: Missing or broken equipment, no supplies (e.g. no TT ball, AC not working, projector missing, no tissue in washroom)
- Person Report: Bad behaviour, harassment, or misconduct by a colleague
- Staff Behaviour: Rude or inconsistent conduct by JPMC staff (reception, cafeteria, security, housekeeping)
- Food Quality: Stale food, bad taste, foreign object, unhygienic conditions at any JPMC outlet or cafeteria
- Workspace Issue: Desk, seating, or locker problems, noise, dirty workstation
- Safety or Security: Hazards, breaches, emergencies, suspicious activity — always flag as CRITICAL
- Recreation Facility: Gym, TT court, badminton, nap room, lounge issues
- Transport or Cab: Driver behaviour, late pickup, shuttle route issues
- HR or Policy Grievance: Payroll discrepancy, leave denial, unfair appraisal
- Cleanliness: Dirty washrooms, pantry, or common areas needing housekeeping

HOW TO HANDLE COMPLAINTS:
1. Listen carefully to identify the complaint type.
2. For FACILITY issues (missing or broken things):
   - Ask "Where exactly is this? Which building and floor?"
   - Call raise_facility_complaint with description and location
   - Tell them it is flagged for QUICK RESOLUTION and facilities will check right away
3. For PERSON or STAFF BEHAVIOUR reports:
   - Ask if they want to name the person or stay anonymous
   - Ask where the incident happened
   - Call report_person with description, reported_person (optional), incident_location, and is_staff (true for JPMC staff, false for colleague)
   - Assure them their identity is fully protected
4. For FOOD QUALITY issues:
   - Ask which outlet or cafeteria had the problem
   - Call report_food_quality with description and outlet_name
   - Tell them the cafeteria team will be alerted immediately
5. For ALL OTHER complaints:
   - Call raise_complaint with the description — the system auto-detects the type and routes to the right team
6. After any complaint: always read out the complaint ID, the team it was sent to, and the SLA timeframe
7. To check a complaint status: call check_complaint with the ID
8. To list their complaints: call my_complaints

JPMC OFFICE LOCATIONS (use for location disambiguation):
- Tower A: Floors 1 to 6. TT Court on Floor 4. Gym on Floor 1. Employee Lounge on Floor 5. Main Reception on Floor 1.
- Tower B: Floors 1 to 7. Tower B Reception on Floor 1.
- Tower C: Floors 1 to 4.

COMPLAINT RULES:
- SAFETY issues: immediately tell them to call security extension 911, then also raise the complaint
- Never minimize or dismiss a harassment or behaviour report
- Always confirm the complaint ID and assigned team to the employee
- Complaints are COMPLETELY SEPARATE from IT tickets — never mix them

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
            description: "Check available meeting rooms or focus rooms for a given date, time, people count and building",
            parameters: {
              type: "object",
              properties: {
                date: { type: "string", description: "Date in YYYY-MM-DD format" },
                start_time: { type: "string", description: "Start time in HH:MM 24hr format" },
                capacity_needed: { type: "number", description: "Number of people attending" },
                room_type: { type: "string", enum: ["meeting", "focus"], description: "'meeting' for group meetings, 'focus' for solo quiet work" },
                building: { type: "string", description: "Preferred building e.g. Tower A, Tower B, Tower C. Use employee's building by default." }
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
        // ── Shuttle Booking Tools ──
        {
          type: "function",
          function: {
            name: "get_available_shuttles",
            description: "Check if employee is registered on GoMyTransport and get available shuttle options for a travel date. Always call this first for any shuttle related request.",
            parameters: {
              type: "object",
              properties: {
                travel_date: { type: "string", description: "Travel date in YYYY-MM-DD format" }
              },
              required: ["travel_date"]
            }
          },
          server: { url: `${SERVER_URL}/shuttle/available` }
        },
        {
          type: "function",
          function: {
            name: "book_shuttle",
            description: "Book a shuttle seat after user selects a timing. Only call after get_available_shuttles and user confirms their choice.",
            parameters: {
              type: "object",
              properties: {
                timing_id: { type: "string", description: "The timing ID like RT001-T2" },
                travel_date: { type: "string", description: "Travel date in YYYY-MM-DD format" }
              },
              required: ["timing_id", "travel_date"]
            }
          },
          server: { url: `${SERVER_URL}/shuttle/book` }
        },
        {
          type: "function",
          function: {
            name: "cancel_shuttle",
            description: "Cancel an existing shuttle booking. Cancellation must be at least 1 hour before departure.",
            parameters: {
              type: "object",
              properties: {
                booking_id: { type: "string", description: "Shuttle booking ID like JPMC-SH-5001" }
              },
              required: ["booking_id"]
            }
          },
          server: { url: `${SERVER_URL}/shuttle/cancel` }
        },
        {
          type: "function",
          function: {
            name: "my_shuttle_bookings",
            description: "List all upcoming confirmed shuttle bookings for the caller",
            parameters: { type: "object", properties: {}, required: [] }
          },
          server: { url: `${SERVER_URL}/shuttle/my-bookings` }
        },
        // ── Food Ordering Tools ──
        {
          type: "function",
          function: {
            name: "search_food",
            description: "Search for food outlets and menu items by cuisine or dish name. Always call this first for food requests. Returns outlet_id and item_ids to use for ordering.",
            parameters: {
              type: "object",
              properties: {
                query: { type: "string", description: "Cuisine or dish the employee wants, e.g. 'chinese', 'biryani', 'coffee'" }
              },
              required: ["query"]
            }
          },
          server: { url: `${SERVER_URL}/food/search` }
        },
        {
          type: "function",
          function: {
            name: "order_by_name",
            description: "Call this when user says what items they want to order. Pass the outlet_id from search_food and the item names as spoken by the user. Returns a confirmation summary before placing the order.",
            parameters: {
              type: "object",
              properties: {
                outlet_id: { type: "string", description: "outlet_id from the search_food result, e.g. OUT002" },
                item_names: { type: "array", items: { type: "string" }, description: "Item names as spoken by user e.g. ['fried rice', 'momos']" }
              },
              required: ["outlet_id", "item_names"]
            }
          },
          server: { url: `${SERVER_URL}/food/order-by-name` }
        },
        {
          type: "function",
          function: {
            name: "place_food_order",
            description: "Place the final confirmed food order. Only call this AFTER user says yes to the confirmation from order_by_name. Use outlet_id and item_ids from the CONFIRM_ORDER response.",
            parameters: {
              type: "object",
              properties: {
                outlet_id: { type: "string", description: "outlet_id from CONFIRM_ORDER response" },
                item_ids:  { type: "array", items: { type: "string" }, description: "item_ids from CONFIRM_ORDER response e.g. ['DW001','DW005']" }
              },
              required: ["outlet_id", "item_ids"]
            }
          },
          server: { url: `${SERVER_URL}/food/place-order` }
        },
        {
          type: "function",
          function: {
            name: "get_menu",
            description: "Get the full menu of a specific outlet by outlet_id",
            parameters: {
              type: "object",
              properties: {
                outlet_id: { type: "string", description: "The outlet ID like OUT001" }
              },
              required: ["outlet_id"]
            }
          },
          server: { url: `${SERVER_URL}/food/get-menu` }
        },
        // ── Knowledge Base Tools ──
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
        },
        // ── Complaints Tools ──
        {
          type: "function",
          function: {
            name: "raise_facility_complaint",
            description: "Raise a quick-resolution facility complaint for missing or broken equipment, no supplies, or non-functioning amenities (e.g. no TT ball, AC not working, projector remote missing, no tissue in washroom). Always ask for the exact location before calling this.",
            parameters: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description: "What is the issue? e.g. 'No TT ball at the TT court', 'AC not working on floor 4', 'Projector remote missing in Aqua room'"
                },
                location: {
                  type: "string",
                  description: "Exact location of the issue, e.g. 'TT Court, Tower A, Floor 4', 'Conference Room Aqua, Tower B', 'Floor 3 washroom, Tower C'"
                }
              },
              required: ["description", "location"]
            }
          },
          server: { url: `${SERVER_URL}/complaints/raise-facility` }
        },
        {
          type: "function",
          function: {
            name: "report_person",
            description: "Report an individual for bad behaviour, misconduct, harassment, discrimination, or inconsistent staff conduct. Set is_staff=true for JPMC operational staff (reception, cafeteria, security, housekeeping). Set is_staff=false for colleague misconduct.",
            parameters: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description: "What happened? Describe the incident clearly."
                },
                reported_person: {
                  type: "string",
                  description: "Name, designation, or description of the person involved (optional — can be left blank for anonymity)"
                },
                incident_location: {
                  type: "string",
                  description: "Where did this happen? e.g. 'Tower A cafeteria', 'Floor 4 common area', 'Main reception'"
                },
                is_staff: {
                  type: "boolean",
                  description: "true if the person is JPMC operational staff (security, cafeteria, reception, housekeeping). false if it is a colleague or employee."
                }
              },
              required: ["description"]
            }
          },
          server: { url: `${SERVER_URL}/complaints/report-person` }
        },
        {
          type: "function",
          function: {
            name: "report_food_quality",
            description: "Report a food quality issue at any JPMC cafeteria or outlet — stale food, bad taste, unhygienic conditions, foreign objects in food, wrong or missing items.",
            parameters: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description: "Describe the food issue, e.g. 'Biryani was stale and had a bad smell', 'Found a hair in the salad'"
                },
                outlet_name: {
                  type: "string",
                  description: "Name of the cafeteria or outlet, e.g. 'Tower A Cafeteria', 'Tower B Food Court'"
                },
                location: {
                  type: "string",
                  description: "Location of the outlet if outlet name is unknown, e.g. 'Tower B, Floor 3'"
                }
              },
              required: ["description"]
            }
          },
          server: { url: `${SERVER_URL}/complaints/report-food` }
        },
        {
          type: "function",
          function: {
            name: "raise_complaint",
            description: "Raise a general complaint for any JPMC office-related issue — workspace problems, safety concerns, transport issues, HR grievances, cleanliness, recreation facilities. The system auto-detects the type and routes it to the correct team. Use this when the issue does not clearly fit facility, person, or food categories.",
            parameters: {
              type: "object",
              properties: {
                description: {
                  type: "string",
                  description: "Full description of the complaint"
                },
                location: {
                  type: "string",
                  description: "Where did this happen or where is the issue? e.g. 'Tower A, Floor 4', 'Main lobby'"
                },
                reported_person: {
                  type: "string",
                  description: "Name of a person involved, if applicable"
                },
                quick_resolution: {
                  type: "boolean",
                  description: "Set to true if this needs immediate attention"
                }
              },
              required: ["description"]
            }
          },
          server: { url: `${SERVER_URL}/complaints/raise` }
        },
        {
          type: "function",
          function: {
            name: "check_complaint",
            description: "Check the current status of a complaint using its complaint ID",
            parameters: {
              type: "object",
              properties: {
                complaint_id: {
                  type: "string",
                  description: "The complaint ID, e.g. JPMC-CMP-1001"
                }
              },
              required: ["complaint_id"]
            }
          },
          server: { url: `${SERVER_URL}/complaints/check` }
        },
        {
          type: "function",
          function: {
            name: "my_complaints",
            description: "List all complaints raised by the current caller",
            parameters: { type: "object", properties: {}, required: [] }
          },
          server: { url: `${SERVER_URL}/complaints/my-complaints` }
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
