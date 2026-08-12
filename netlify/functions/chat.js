// netlify/functions/chat.js  
//
// خدمة "الذكاء الاصطناعي" في منصة مستقبلي.
// تستقبل رسالة المستخدم من الواجهة (index.html -> /.netlify/functions/chat)
// وترسلها إلى Gemini API، ثم تعيد رد الذكاء الاصطناعي كنص JSON.
//
// ⚠️ سبب العطل السابق: gemini-1.5-flash (وكل نماذج 1.0 / 1.5) تم إيقافها
// نهائيًا من Google، وحتى gemini-2.0-flash تم إيقافه في 1 يونيو 2026.
// النموذج الحالي المستقر (أغسطس 2026) هو gemini-2.5-flash.
//
// هذا الملف يجرّب عدة نماذج بالترتيب تلقائيًا (fallback)، فإذا أوقفت Google
// نموذجًا معينًا في المستقبل، تنتقل الدالة تلقائيًا للنموذج التالي في القائمة
// دون أن ينكسر الموقع فجأة.
//
// الإعداد المطلوب على Netlify:
//   Site settings → Environment variables → أضف:
//     GEMINI_API_KEY = مفتاح Gemini API الخاص بك (من Google AI Studio)
//   اختياري:
//     GEMINI_MODEL = اسم نموذج معيّن تريد تجربته أولًا قبل قائمة الاحتياط أدناه
//
// لا حاجة لأي تثبيت (npm install) — الدالة تستخدم fetch المدمجة في بيئة
// Netlify Functions (Node 18+).

// قائمة النماذج المرشّحة، بالترتيب من الأفضل/الأحدث المستقر إلى الأبسط.
// إذا رجع خطأ "model not found" أو 404 من نموذج، تجرّب الدالة النموذج التالي.
const FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest'
];

const MAX_MESSAGE_LENGTH = 4000;

function buildModelList() {
  const preferred = (process.env.GEMINI_MODEL || '').trim();
  const list = preferred ? [preferred, ...FALLBACK_MODELS] : [...FALLBACK_MODELS];
  // إزالة التكرار مع الحفاظ على الترتيب
  return [...new Set(list)];
}

async function callGemini(model, apiKey, message) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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
  return { ok: response.ok, status: response.status, data };
}

function isModelUnavailableError(status, data) {
  if (status === 404) return true;
  const msg = ((data && data.error && data.error.message) || '').toLowerCase();
  return msg.includes('not found') || msg.includes('not supported for generatecontent');
}

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

  const modelsToTry = buildModelList();
  let lastError = 'تعذّر الاتصال بخدمة الذكاء الاصطناعي.';
  let lastStatus = 502;

  for (const model of modelsToTry) {
    try {
      const { ok, status, data } = await callGemini(model, apiKey, message);

      if (ok) {
        const candidate = data && data.candidates && data.candidates[0];
        const reply = candidate && candidate.content && candidate.content.parts
          ? candidate.content.parts.map((p) => p.text || '').join('').trim()
          : '';

        if (reply) {
          return { statusCode: 200, headers, body: JSON.stringify({ reply, model }) };
        }

        // نجح الاتصال لكن بدون نص رد (مثلاً بسبب فلترة أمان) — لا نجرّب نموذجًا آخر بلا فائدة
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ reply: 'لم أتمكن من توليد رد على هذا السؤال، جرّب صياغته بشكل مختلف.' })
        };
      }

      // إذا كان الخطأ لأن النموذج غير موجود/غير مدعوم، جرّب النموذج التالي في القائمة
      if (isModelUnavailableError(status, data)) {
        lastError = (data && data.error && data.error.message) || `النموذج ${model} غير متاح حاليًا.`;
        lastStatus = status;
        continue;
      }

      // أي خطأ آخر (مفتاح خاطئ، تجاوز الحصة، ...) لا فائدة من تكراره على نموذج آخر
      const errMsg = (data && data.error && data.error.message) || 'حدث خطأ في الاتصال بخدمة الذكاء الاصطناعي.';
      return { statusCode: status, headers, body: JSON.stringify({ error: errMsg }) };
    } catch (err) {
      lastError = 'تعذّر الاتصال بخدمة الذكاء الاصطناعي. حاول مرة أخرى بعد قليل.';
      lastStatus = 500;
    }
  }

  // كل النماذج في القائمة فشلت
  return {
    statusCode: lastStatus,
    headers,
    body: JSON.stringify({
      error: `تعذّر الوصول إلى أي نموذج Gemini متاح حاليًا. آخر خطأ: ${lastError}`
    })
  };
};
