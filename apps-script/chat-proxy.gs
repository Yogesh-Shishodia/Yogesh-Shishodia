/**
 * Hanu AI chat proxy — keeps the OpenRouter key off the website.
 *
 * Setup (script.google.com → New project, paste this file):
 *   1. Project Settings → Script Properties → add OPENROUTER_API_KEY = <your new key>
 *   2. Deploy → New deployment → Web app
 *        Execute as: Me    Who has access: Anyone
 *   3. Copy the /exec URL into CHAT_URL in index.html.
 * After editing this file: Deploy → Manage deployments → Edit → Version: New version
 * (keeps the same URL).
 */

const MODEL = 'openrouter/free';
const MAX_TOKENS = 400;
const MAX_MESSAGES = 12;       // conversation turns sent to the model
const MAX_CHARS = 1000;        // per message
const LIMIT_PER_MINUTE = 20;   // across all visitors
const LIMIT_PER_DAY = 500;     // across all visitors

// Kept server-side so the proxy can only be used as the Adaptive Minds assistant.
const SYSTEM = `You are the AI assistant for Adaptive Minds AI, an AI automation agency based in India serving global clients. Help potential clients understand our services.

COMPANY:
- Name: Adaptive Minds AI | Founded by: Yogesh Shishodia
- India-based, serving global clients | 20+ AI projects, 5+ industries, 100% custom-built
- Deployment: On-Premise, Private Cloud (AWS/Azure/GCP), Hybrid
- Contact: contact@adaptivemindsai.com | WhatsApp: +91 81302 47554

SERVICES:
1. Workflow Automation — automate approvals, data entry, notifications
2. AI Assistants & Chatbots — 24/7 support on WhatsApp, website, Slack
3. Autonomous AI Agents — multi-step tasks without human triggers
4. Document Intelligence — chat with any document, answers with citations
5. Intelligent Data Extraction — extract structured data from PDFs, invoices, forms
6. System Integration — connect AI to CRM (Salesforce/Zoho/HubSpot), ERP (SAP/Oracle/Tally), email
7. Business Intelligence — surface insights from operational data in plain language
8. Content Automation — AI writing in your brand's voice
9. Custom AI Development — domain-specific AI trained on client data

PRODUCTS:
- DocuAgent AI: Secure on-premise document intelligence. Chat with contracts/reports/PDFs on your own hardware. HIPAA/GDPR/DPDP compliant. Supports 12+ formats. Every answer cited.
- InboxIQ: AI email triage for Gmail/Outlook. Identifies high-priority emails, drafts replies, tracks unanswered threads.

WHO WE SERVE: Legal Firms, Healthcare, BFSI, HR & Operations, Manufacturing, Startups & SaaS, Consulting, EdTech

OUR PROCESS:
1. Free AI Audit (30-min call, no commitment)
2. Scope & Proposal (client approves before work starts)
3. Build & Test (weekly updates, client tests before go-live)
4. Deploy & Support (ongoing support and iteration)

COMPLIANCE: HIPAA Ready, GDPR Compliant, DPDP compliant. Full audit trail on every AI action.

PRICING: Custom quotes after the free AI audit — every system is bespoke.

YOUR BEHAVIOR:
- Be concise (under 200 words), warm, professional
- Use bullet points when listing multiple items
- For pricing questions: explain custom quotes post-audit
- To get started: direct to Free AI Audit via email or WhatsApp
- Stay on topic about Adaptive Minds AI only
- Don't make up facts not mentioned above`;

function doPost(e) {
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const messages = sanitize_(body.messages);
    if (!messages.length) return json_({ error: 'bad_request' });
    if (!withinLimits_()) return json_({ error: 'busy' });

    const key = PropertiesService.getScriptProperties().getProperty('OPENROUTER_API_KEY');
    const res = UrlFetchApp.fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'post',
      contentType: 'application/json',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + key,
        'HTTP-Referer': 'https://www.adaptivemindsai.com/',
        'X-Title': 'Adaptive Minds AI Assistant'
      },
      payload: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYSTEM }].concat(messages),
        max_tokens: MAX_TOKENS,
        temperature: 0.7
      })
    });

    const data = JSON.parse(res.getContentText());
    const reply = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!reply) {
      console.error('OpenRouter error', res.getResponseCode(), res.getContentText());
      return json_({ error: 'upstream' });
    }
    return json_({ reply: reply });
  } catch (err) {
    console.error(err);
    return json_({ error: 'server' });
  }
}

// Only user/assistant turns, trimmed, most recent MAX_MESSAGES — the client can't inject a system prompt.
function sanitize_(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES)
    .map(m => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
}

// Global counters (Apps Script can't see visitor IPs) — caps spend if the URL is abused.
function withinLimits_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const now = new Date();
    const minuteKey = 'm_' + Utilities.formatDate(now, 'Asia/Kolkata', 'yyyyMMddHHmm');
    const dayKey = 'd_' + Utilities.formatDate(now, 'Asia/Kolkata', 'yyyyMMdd');
    const cache = CacheService.getScriptCache();
    const props = PropertiesService.getScriptProperties();

    const perMinute = Number(cache.get(minuteKey) || 0);
    const perDay = Number(props.getProperty(dayKey) || 0);
    if (perMinute >= LIMIT_PER_MINUTE || perDay >= LIMIT_PER_DAY) return false;

    cache.put(minuteKey, String(perMinute + 1), 120);
    if (perDay === 0) clearOldDays_(props, dayKey);
    props.setProperty(dayKey, String(perDay + 1));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function clearOldDays_(props, keep) {
  Object.keys(props.getProperties())
    .filter(k => k.indexOf('d_') === 0 && k !== keep)
    .forEach(k => props.deleteProperty(k));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
