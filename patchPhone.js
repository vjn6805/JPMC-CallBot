require('dotenv').config();

async function patchPhoneNumber() {
  const phoneNumberId = '11b735e1-dcb5-4462-a07f-3d67325d4f7e';
  const apiKey = process.env.VAPI_API_KEY;
  const serverUrl = process.env.SERVER_URL;

  console.log(`🔧 Patching vAPI phone number...`);
  console.log(`   Server URL: ${serverUrl}/vapi/auth-hook`);

  const response = await fetch(`https://api.vapi.ai/phone-number/${phoneNumberId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      assistantId: null,
      server: { url: `${serverUrl}/vapi/auth-hook` }
    })
  });

  const data = await response.json();

  if (data.id) {
    console.log('✅ Phone number patched successfully!');
    console.log(`   Assistant: ${data.assistantId || 'none (correct)'}`);
    console.log(`   Server: ${data.server?.url}`);
  } else {
    console.log('❌ Failed:', JSON.stringify(data, null, 2));
  }
}

patchPhoneNumber();
