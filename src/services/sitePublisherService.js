// cPanel-style "Site Publisher": a domain owner picks one of a fixed set
// of self-contained static HTML templates, fills in a handful of fields,
// and publishes the rendered page straight to their domain's document
// root — no File Manager or Terminal access required.
//
// Every template is a plain JS function producing a complete HTML
// document (inline CSS, no external requests) so the exact same markup
// works whether it's written to disk or shown in a sandboxed <iframe
// srcdoc> preview. Field values are HTML-escaped before interpolation —
// not because another user could see them (this only ever writes into a
// domain the caller already owns), but because an unescaped `"` or `<` in
// a site title would otherwise break the page's own markup.
const fsPromises = require('fs').promises;
const path = require('path');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const FILENAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,60}\.html$/;

const FIELDS = [
  { key: 'siteTitle', label: 'Site Title', type: 'text', required: true, maxLength: 100 },
  { key: 'tagline', label: 'Tagline', type: 'text', required: false, maxLength: 200 },
  { key: 'description', label: 'Description', type: 'textarea', required: false, maxLength: 1000 },
  { key: 'contactEmail', label: 'Contact Email', type: 'email', required: false, maxLength: 200 },
  { key: 'accentColor', label: 'Accent Color', type: 'color', required: false, maxLength: 20 }
];

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function baseDocument({ title, accent, bodyHtml, extraStyle = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1f2937; background: #f8fafc; }
  a { color: var(--accent); }
${extraStyle}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

// Shared centered-card layout used by coming-soon / under-construction /
// maintenance — they differ only in badge text/icon and copy.
function centeredCard(f, badge, icon) {
  return baseDocument({
    title: f.siteTitle,
    accent: f.accentColor,
    extraStyle: `
  .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 2rem; background: linear-gradient(135deg, var(--accent), #0f172a); }
  .card { background: #fff; border-radius: 16px; padding: 3rem 2.5rem; max-width: 520px; width: 100%; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,.25); }
  .icon { font-size: 2.5rem; margin-bottom: .75rem; }
  .badge { display: inline-block; padding: .35rem .9rem; border-radius: 999px; background: #f1f5f9; color: var(--accent); font-size: .75rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 1rem; }
  h1 { margin: 0 0 .5rem; font-size: 2rem; }
  .tagline { color: #64748b; font-size: 1.05rem; margin: 0 0 1rem; }
  .desc { color: #475569; line-height: 1.6; margin: 0 0 1.5rem; }
  .contact { display: inline-block; padding: .6rem 1.2rem; border: 1px solid var(--accent); border-radius: 8px; text-decoration: none; font-weight: 600; }`,
    bodyHtml: `
<div class="wrap"><div class="card">
  ${icon ? `<div class="icon">${icon}</div>` : ''}
  <span class="badge">${escapeHtml(badge)}</span>
  <h1>${escapeHtml(f.siteTitle)}</h1>
  ${f.tagline ? `<p class="tagline">${escapeHtml(f.tagline)}</p>` : ''}
  ${f.description ? `<p class="desc">${escapeHtml(f.description)}</p>` : ''}
  ${f.contactEmail ? `<a class="contact" href="mailto:${escapeHtml(f.contactEmail)}">Get in touch</a>` : ''}
</div></div>`
  });
}

const TEMPLATES = {
  'coming-soon': {
    label: 'Coming Soon',
    description: 'A simple "launching soon" placeholder page.',
    defaultAccentColor: '#6366f1',
    render: (f) => centeredCard(f, 'Coming Soon', '')
  },
  'under-construction': {
    label: 'Under Construction',
    description: 'Lets visitors know the site is actively being built.',
    defaultAccentColor: '#f59e0b',
    render: (f) => centeredCard(f, 'Under Construction', '🚧')
  },
  maintenance: {
    label: 'Maintenance',
    description: '"We\'ll be back soon" page for planned downtime.',
    defaultAccentColor: '#0ea5e9',
    render: (f) => centeredCard(f, 'Under Maintenance', '🛠️')
  },
  personal: {
    label: 'Personal',
    description: 'A one-page personal bio / landing page.',
    defaultAccentColor: '#10b981',
    render: (f) => baseDocument({
      title: f.siteTitle,
      accent: f.accentColor,
      extraStyle: `
  .hero { padding: 4rem 1.5rem 3rem; text-align: center; background: #fff; border-bottom: 4px solid var(--accent); }
  .avatar { width: 88px; height: 88px; border-radius: 50%; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 2rem; font-weight: 700; margin: 0 auto 1rem; }
  .hero h1 { margin: 0 0 .35rem; font-size: 2.25rem; }
  .hero .tagline { color: #64748b; font-size: 1.1rem; margin: 0; }
  .section { max-width: 640px; margin: 0 auto; padding: 2.5rem 1.5rem; }
  .section p { line-height: 1.7; color: #334155; }
  .contact-btn { display: inline-block; margin-top: 1rem; padding: .7rem 1.4rem; background: var(--accent); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }`,
      bodyHtml: `
<div class="hero">
  <div class="avatar">${escapeHtml((f.siteTitle || '?').trim().charAt(0).toUpperCase())}</div>
  <h1>${escapeHtml(f.siteTitle)}</h1>
  ${f.tagline ? `<p class="tagline">${escapeHtml(f.tagline)}</p>` : ''}
</div>
<div class="section">
  ${f.description ? `<p>${escapeHtml(f.description)}</p>` : ''}
  ${f.contactEmail ? `<a class="contact-btn" href="mailto:${escapeHtml(f.contactEmail)}">Say hello</a>` : ''}
</div>`
    })
  },
  business: {
    label: 'Business',
    description: 'A simple business landing page with a hero and contact section.',
    defaultAccentColor: '#2563eb',
    render: (f) => baseDocument({
      title: f.siteTitle,
      accent: f.accentColor,
      extraStyle: `
  nav { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 2rem; background: #fff; border-bottom: 1px solid #e2e8f0; }
  nav .logo { font-weight: 800; font-size: 1.2rem; color: #0f172a; }
  nav .links a { margin-left: 1.5rem; text-decoration: none; color: #475569; font-weight: 600; font-size: .9rem; }
  .hero { text-align: center; padding: 5rem 1.5rem; background: linear-gradient(180deg, #fff, #f1f5f9); }
  .hero h1 { font-size: 2.5rem; margin: 0 0 1rem; color: #0f172a; }
  .hero p { max-width: 560px; margin: 0 auto; color: #475569; font-size: 1.1rem; line-height: 1.7; }
  .contact { max-width: 480px; margin: 0 auto; padding: 3rem 1.5rem; text-align: center; }
  .contact a { display: inline-block; margin-top: .75rem; padding: .7rem 1.4rem; background: var(--accent); color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; }
  footer { text-align: center; padding: 1.5rem; color: #94a3b8; font-size: .8rem; }`,
      bodyHtml: `
<nav><span class="logo">${escapeHtml(f.siteTitle)}</span><span class="links"><a href="#about">About</a><a href="#contact">Contact</a></span></nav>
<div class="hero">
  <h1>${escapeHtml(f.tagline || f.siteTitle)}</h1>
  ${f.description ? `<p>${escapeHtml(f.description)}</p>` : ''}
</div>
${f.contactEmail ? `<div class="contact" id="contact"><h2>Get in touch</h2><a href="mailto:${escapeHtml(f.contactEmail)}">${escapeHtml(f.contactEmail)}</a></div>` : ''}
<footer>&copy; ${new Date().getFullYear()} ${escapeHtml(f.siteTitle)}. All rights reserved.</footer>`
    })
  }
};

function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key, label: t.label, description: t.description, defaultAccentColor: t.defaultAccentColor
  }));
}

function fieldsSchema() {
  return FIELDS;
}

// Validates raw form input against FIELDS and this template's default
// accent color. Returns { values, errors } rather than throwing on a bad
// field — mirrors express-validator's array-of-errors shape so routes can
// hand it straight back as a 400.
function validateFields(templateKey, raw = {}) {
  const template = TEMPLATES[templateKey];
  if (!template) {
    throw Object.assign(new Error(`Unknown template: ${templateKey}`), { code: 'UNKNOWN_TEMPLATE' });
  }

  const errors = [];
  const values = {};

  for (const field of FIELDS) {
    const value = raw[field.key] === undefined || raw[field.key] === null ? '' : String(raw[field.key]).trim();

    if (field.required && !value) {
      errors.push({ field: field.key, message: `${field.label} is required` });
      continue;
    }
    if (value.length > field.maxLength) {
      errors.push({ field: field.key, message: `${field.label} must be ${field.maxLength} characters or fewer` });
      continue;
    }
    if (field.type === 'email' && value && !EMAIL_RE.test(value)) {
      errors.push({ field: field.key, message: 'Contact email is not a valid email address' });
      continue;
    }
    if (field.key === 'accentColor' && value && !HEX_COLOR_RE.test(value)) {
      errors.push({ field: field.key, message: 'Accent color must be a hex color like #6366f1' });
      continue;
    }
    values[field.key] = value;
  }

  if (!values.accentColor) values.accentColor = template.defaultAccentColor;
  return { values, errors };
}

function render(templateKey, values) {
  const template = TEMPLATES[templateKey];
  if (!template) {
    throw Object.assign(new Error(`Unknown template: ${templateKey}`), { code: 'UNKNOWN_TEMPLATE' });
  }
  return template.render(values);
}

// A bare "name.html" only — no path separators, no traversal segments.
// Returns null (never throws) so callers can turn a bad filename into a
// normal 400 the same way a failed express-validator rule would.
function sanitizeFilename(name) {
  const candidate = (name || 'index.html').trim() || 'index.html';
  return FILENAME_RE.test(candidate) ? candidate : null;
}

// documentRoot is a value the caller has already resolved and checked
// with isPathSafe/isCriticalSystemPath (see routes/files.js) — this
// function's own job is just making sure the sanitized filename can't
// still walk the write outside that root.
async function publishToDocumentRoot(documentRoot, filename, html) {
  const resolvedRoot = path.resolve(documentRoot);
  const target = path.join(resolvedRoot, filename);
  if (path.dirname(target) !== resolvedRoot) {
    throw Object.assign(new Error('Resolved publish path escapes the document root'), { code: 'UNSAFE_PATH' });
  }
  await fsPromises.mkdir(resolvedRoot, { recursive: true });
  await fsPromises.writeFile(target, html, 'utf8');
  return target;
}

module.exports = {
  listTemplates,
  fieldsSchema,
  validateFields,
  render,
  sanitizeFilename,
  publishToDocumentRoot
};
