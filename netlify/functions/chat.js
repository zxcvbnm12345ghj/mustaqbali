// netlify/functions/chat.js
//
// خدمة "الذكاء الاصطناعي" في منصة مستقبلي.
// تستقبل رسالة المستخدم من الواجهة (index.html -> /.netlify/functions/chat)
// وترسلها إلى Gemini API، ثم تعيد رد الذكاء الاصطناعي كنص JSON.
//
// الإعداد المطلوب على Netlify:
//   Site settings → Environment variables → أضف:
//     GEMINI_API_KEY = مفتاح Gemini API الخاص بك (من Google AI Studio)
//   اختياري:
//     GEMINI_MODEL = اسم النموذج (الافتراضي: gemini-2.0-flash)
//
// لا حاجة لأي تثبيت (npm install) — الدالة تستخدم fetch المدمجة في بيئة
// Netlify Functions (Node 18+).

const DEFAULT_MODEL = 'gemini-1.5-flash';
const MAX_MESSAGE_LENGTH = 4000;

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // طلبات CORS التمهيدية
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'يُسمح فقط بطلبات POST.' })
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'مفتاح GEMINI_API_KEY غير مُعرَّف في متغيرات البيئة على Netlify. أضفه من: Site settings → Environment variables.'
      })
    };
  }

  let message = '';
  try {
    const parsed = JSON.parse(event.body || '{}');
    message = (parsed.message || '').toString().trim();
  } catch (err) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'صيغة الطلب غير صحيحة (يجب أن تكون JSON تحتوي على حقل message).' })
    };
  }

  if (!message) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'الرسالة فارغة.' }) };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    message = message.slice(0, MAX_MESSAGE_LENGTH);
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: message }] }
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024
        }
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errMsg = (data && data.error && data.error.message) || 'حدث خطأ في الاتصال بخدمة الذكاء الاصطناعي.';
      return { statusCode: response.status, headers, body: JSON.stringify({ error: errMsg }) };
    }

    const candidate = data && data.candidates && data.candidates[0];
    const reply = candidate && candidate.content && candidate.content.parts
      ? candidate.content.parts.map((p) => p.text || '').join('').trim()
      : '';

    if (!reply) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ reply: 'لم أتمكن من توليد رد على هذا السؤال، جرّب صياغته بشكل مختلف.' })
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ reply }) };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'تعذّر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى بعد قليل.' })
    };
  }
};
