import { decryptGantt, parseCapabilityHref } from './crypto.mjs';

const status = document.getElementById('status');
const frame = document.getElementById('chart');

function unavailable() {
  frame.hidden = true;
  frame.removeAttribute('srcdoc');
  status.hidden = false;
  status.querySelector('h1').textContent = 'Timeline unavailable';
  status.querySelector('p').textContent =
    'Check that you opened the complete link. Ask your coordinator for a new link if this continues.';
}

async function open() {
  try {
    const key = parseCapabilityHref(window.location.href);
    const dataUrl = new URL('./data/gantt.enc.json', window.location.href);
    dataUrl.searchParams.set('fresh', String(Date.now()));
    const response = await fetch(dataUrl, {
      cache: 'no-store', credentials: 'omit', redirect: 'error',
    });
    if (!response.ok) throw new Error('Unavailable');
    const body = await response.text();
    if (body.length > 1_700_000) throw new Error('Invalid encrypted chart');
    const html = await decryptGantt(JSON.parse(body), key);
    frame.srcdoc = html;
    frame.hidden = false;
    status.hidden = true;
  } catch {
    unavailable();
  }
}

void open();
