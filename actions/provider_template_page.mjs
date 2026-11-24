// Internal Gantt panel for a human-reviewed Outlook handoff. It never uses
// history navigation, so Back and Home retain the complete private fragment.
import {parseProviderTemplateCatalog, buildProviderPartsTemplate,
  providerPartsClipboardPayload, providerOutlookHeader} from
  './provider_anytime_template.mjs';
import {writeClipboardPayload} from './clipboard_writer.mjs';

export function createProviderTemplatePage({document, navigator, onReturn}) {
  const $ = id => document.getElementById(id);
  const page = $('providerTemplatePage');
  const heading = $('providerTemplateHeading');
  const source = $('providerTemplateSource');
  const select = $('providerWoSelect');
  const manual = $('providerManualFields');
  const manualWo = $('providerManualWo');
  const manualAgent = $('providerManualAgent');
  const context = $('providerWoContext');
  const recipientNote = $('providerRecipientNote');
  const to = $('providerTo');
  const subject = $('providerSubject');
  const preview = $('providerBodyPreview');
  const plainDetails = $('providerPlainDetails');
  const plainBody = $('providerPlainBody');
  const copy = $('providerTemplateCopy');
  const copyStatus = $('providerTemplateCopyStatus');
  const copyFallback = $('providerCopyFallback');
  const selectBody = $('providerSelectBody');
  const manualConfirm = $('providerManualCopied');
  const openOutlook = $('providerTemplateOutlook');
  const back = $('providerBack');
  const home = $('providerHome');
  if ([page, heading, source, select, manual, manualWo, manualAgent,
      context, recipientNote, to, subject, preview, plainDetails, plainBody, copy,
      copyStatus, copyFallback, selectBody, manualConfirm, openOutlook,
      back, home].some(value => !value) || typeof onReturn !== 'function') {
    throw new TypeError('Provider template panel is incomplete');
  }

  let catalog = null;
  let template = null;
  let payload = null;
  let copied = false;
  let copying = false;
  let generation = 0;

  function disableOutlook() {
    openOutlook.removeAttribute('href');
    openOutlook.setAttribute('aria-disabled', 'true');
    openOutlook.tabIndex = -1;
  }

  function updateOutlook() {
    disableOutlook();
    if (!copied || !template || copying) return;
    try {
      const header = providerOutlookHeader(to.value, subject.value);
      openOutlook.href = header.url;
      openOutlook.setAttribute('aria-disabled', 'false');
      openOutlook.tabIndex = 0;
    } catch {
      copyStatus.textContent =
        'Check the To addresses and subject before opening Outlook. No message was sent.';
    }
  }

  function clearCopy() {
    generation++;
    copied = false;
    copying = false;
    manualConfirm.checked = false;
    copyFallback.hidden = true;
    disableOutlook();
    copyStatus.textContent = 'The message has not been copied.';
  }

  function refreshTemplate() {
    clearCopy();
    template = null;
    payload = null;
    preview.replaceChildren();
    plainBody.value = '';
    to.value = '';
    subject.value = '';
    copy.disabled = true;
    const isManual = select.value === 'manual';
    manual.hidden = !isManual;
    if (!catalog || !select.value) {
      context.textContent =
        'Choose a charted Installation work order or enter another one.';
      recipientNote.textContent =
        'Recipient suggestions appear only after an exact charted work order is chosen.';
      return;
    }
    let item = null;
    let workOrderNumber;
    let agentCode;
    if (isManual) {
      workOrderNumber = manualWo.value.trim();
      agentCode = manualAgent.value.trim().toUpperCase();
      context.textContent =
        'Manual work order: the number, Installation type, SP agent, status and date are unverified. Check the current Thirsty record before ordering.';
      recipientNote.textContent =
        'Manual entry has no verified contact linkage. To is blank; find current install manager and planner for this SP agent code.';
    } else {
      item = catalog.installations.find(row => row.id === select.value);
      if (!item) {
        context.textContent = 'This work order is not in the authenticated chart.';
        recipientNote.textContent = 'To is blank.';
        return;
      }
      workOrderNumber = item.workOrderNumber;
      agentCode = item.agentCode;
      const store = item.storeNumber ?? 'unverified';
      const date = item.spActivityDate
        ? `${item.spActivityDate} (unconfirmed)` : 'not recorded (unconfirmed)';
      context.textContent =
        `WO ${workOrderNumber} · SP agent ${agentCode ?? 'unverified'} · store ${store} · chart status ${item.status} as of ${catalog.asOfDate}. SP activity date: ${date}. Verify all current details in Thirsty.`;
      if (item.suggestedRecipients.length === 2) {
        recipientNote.textContent =
          `Two contact addresses are suggested for SP agent ${agentCode} from the dated provider files. Verify both roles and the exact WO before Send.`;
      } else if (item.suggestedRecipients.length === 1) {
        recipientNote.textContent =
          `The saved install manager and planner fields for SP agent ${agentCode} share one mailbox. One address is suggested; verify both roles before Send.`;
      } else {
        recipientNote.textContent =
          `No unambiguous contact suggestion is linked to SP agent ${agentCode}. To is blank; verify the current install manager and planner.`;
      }
    }
    try {
      template = buildProviderPartsTemplate({workOrderNumber, agentCode,
        asOfDate: catalog.asOfDate,
        sourceMode: isManual ? 'manual' : 'charted',
        suggestedRecipients: isManual ? [] : item.suggestedRecipients});
      payload = providerPartsClipboardPayload(template);
      preview.innerHTML = payload.html;
      for (const anchor of preview.querySelectorAll('a')) {
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.referrerPolicy = 'no-referrer';
      }
      plainBody.value = payload.plainText;
      to.value = template.to.join('; ');
      subject.value = template.subject;
      copy.disabled = false;
    } catch {
      context.textContent += ' Enter a valid 5–12 digit WO number and SP agent code to prepare the template.';
    }
  }

  async function onCopy(event) {
    if (!event.isTrusted || event.button !== 0 ||
        copying || !template || !payload) return;
    const current = ++generation;
    copied = false;
    copying = true;
    copy.disabled = true;
    disableOutlook();
    copyFallback.hidden = true;
    copyStatus.textContent = 'Copying the complete message. Outlook has not opened.';
    // The first Clipboard API call occurs in this trusted click stack.
    const request = writeClipboardPayload(payload, navigator.clipboard);
    try {
      const format = await request;
      if (current !== generation) return;
      copied = true;
      copyStatus.textContent = format === 'html+plain'
        ? 'Copied. All six part names are clickable links in the rich message. Open Outlook, paste, then verify recipients, links, quantities, status and date before Send.'
        : 'Copied as plain text with all six full URLs. Rich links were unavailable: after pasting in Outlook, link each part name to its matching URL before Send.';
    } catch {
      if (current !== generation) return;
      copyFallback.hidden = false;
      plainDetails.open = true;
      copyStatus.textContent =
        'Clipboard access was unavailable. Select and copy the full plain-text message above, confirm it, then add clickable part-name links in Outlook before Send.';
    } finally {
      if (current === generation) {
        copying = false;
        copy.disabled = false;
        updateOutlook();
      }
    }
  }

  function onManualConfirmation(event) {
    if (!event.isTrusted || copyFallback.hidden || !template ||
        plainBody.value !== payload?.plainText) {
      manualConfirm.checked = false;
      return;
    }
    copied = manualConfirm.checked;
    copyStatus.textContent = copied
      ? 'You confirmed copying the full plain-text message. Add clickable part-name links after pasting in Outlook, then verify everything before Send.'
      : 'Copy the full message before opening Outlook.';
    updateOutlook();
  }

  function onOutlookClick(event) {
    if (!event.isTrusted || event.button !== 0 || !copied || !template) {
      event.preventDefault();
      updateOutlook();
      return;
    }
    try {
      const header = providerOutlookHeader(to.value, subject.value);
      if (openOutlook.getAttribute('href') !== header.url) {
        event.preventDefault();
        updateOutlook();
        return;
      }
    } catch {
      event.preventDefault();
      updateOutlook();
      return;
    }
    copyStatus.textContent = to.value.trim()
      ? 'Outlook opening requested with suggested To and subject only. Paste the copied body and verify it before Send. Opening again can make another unsent draft.'
      : 'Outlook opening requested with subject only. Add current recipients, paste the copied body and verify it before Send. Opening again can make another unsent draft.';
  }

  function clearPage() {
    clearCopy();
    template = null;
    payload = null;
    select.value = '';
    manualWo.value = '';
    manualAgent.value = '';
    manual.hidden = true;
    to.value = '';
    subject.value = '';
    plainBody.value = '';
    preview.replaceChildren();
    page.hidden = true;
  }

  select.addEventListener('change', refreshTemplate);
  manualWo.addEventListener('input', refreshTemplate);
  manualAgent.addEventListener('input', refreshTemplate);
  to.addEventListener('input', updateOutlook);
  subject.addEventListener('input', updateOutlook);
  copy.addEventListener('click', event => { void onCopy(event); });
  selectBody.addEventListener('click', event => {
    if (!event.isTrusted || copyFallback.hidden || !plainBody.value) return;
    plainBody.focus();
    plainBody.select();
    copyStatus.textContent =
      'Full message selected. Press Ctrl+C, then confirm you copied it. Add clickable part-name links in Outlook.';
  });
  manualConfirm.addEventListener('change', onManualConfirmation);
  openOutlook.addEventListener('click', onOutlookClick);
  openOutlook.addEventListener('auxclick', event => event.preventDefault());
  back.addEventListener('click', () => { clearPage(); onReturn(false); });
  home.addEventListener('click', () => { clearPage(); onReturn(true); });

  return Object.freeze({
    configure(html) {
      clearPage();
      catalog = parseProviderTemplateCatalog(html);
      select.replaceChildren();
      select.add(new Option('Choose a work order', ''));
      for (const item of catalog.installations) {
        const label = `WO ${item.workOrderNumber} · ${item.agentCode ?? 'agent unverified'} · ${item.status}`;
        select.add(new Option(label, item.id));
      }
      select.add(new Option('Another Installation WO — enter manually', 'manual'));
      source.textContent =
        `Gantt chart snapshot as of ${catalog.asOfDate}. This editable template has no time cutoff. The snapshot does not confirm today's work order status, contact roles or SP date; verify them in Thirsty before Send.`;
      return catalog.installations.length;
    },
    open(selected) {
      if (!catalog) return false;
      page.hidden = false;
      select.value = selected?.kind === 'provider' &&
        catalog.installations.some(item => item.id === selected.id)
        ? selected.id : '';
      refreshTemplate();
      heading.focus();
      return true;
    },
    reset() {
      clearPage();
      catalog = null;
      select.replaceChildren();
      source.textContent = 'Source: unverified.';
    },
    isReady() { return Boolean(catalog); },
  });
}
