const express = require('express');
const router = express.Router();

let twilioClient = null;
if (process.env.TWILIO_ENABLED === 'true' && process.env.TWILIO_ACCOUNT_SID) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

async function sendSMS(to, message) {
  if (!twilioClient) {
    console.log(`[SMS] Would send to ${to}: ${message.substring(0, 50)}...`);
    return { success: false, error: 'SMS not configured' };
  }
  try {
    const result = await twilioClient.messages.create({ body: message, to, from: process.env.TWILIO_PHONE_NUMBER });
    return { success: true, sid: result.sid };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

router.post('/send', express.json(), async (req, res) => {
  const { to, message } = req.body;
  const result = await sendSMS(to, message);
  res.json(result);
});

module.exports = router;
module.exports.sendSMS = sendSMS;
