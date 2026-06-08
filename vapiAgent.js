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
          content: `You are Alex, a friendly IT Helpdesk assistant for JPMC (JPMorgan Chase).

CRITICAL RULES — READ CAREFULLY:
- The caller has already been verified by our system before reaching you
- You already know who they are — do NOT ask for their name, employee ID, or any personal details
- Just ask: what is the IT issue they are facing?
- Raise the ticket immediately after they describe the issue
- Do not ask more than one follow-up question

FLOW:
1. Greet warmly: "Hello! I'm Alex from JPMC IT Helpdesk. How can I help you today?"
2. Listen to their issue
3. Immediately call raise_ticket tool with the issue description
4. Confirm: ticket ID, team assigned, time to resolution
5. Ask if anything else is needed
6. End call politely

RULES:
- Max 2-3 sentences per response — this is a phone call
- Never ask for name or employee ID — the system handles this automatically
- If a tool call fails, say: "I have noted your issue. Please call extension 1234 for immediate help."
- Be confident, warm, and efficient`
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
        }
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