const WO_ID = /^0WO[A-Za-z0-9]{15}$/;
const FORM_KEY = /^F:[0-9]{1,20}:[0-9]{1,20}$/;
const NUMBER = /^[0-9]{5,12}$/;
const STORE = /^[0-9]{1,7}$/;
const ACN = /^[0-9]{4,12}$/;
const AGENT = /^[A-Za-z][A-Za-z0-9]{0,9}$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const PREINSTALL = new Set(['Pending Readiness', 'Pending Scheduled Date']);

function readJsonScript(html, id, maxLength) {
  const expression = new RegExp(`<script type="application/json" id="${id}">([^<]+)<\\/script>`, 'g');
  const found = [...html.matchAll(expression)];
  if (found.length !== 1 || found[0][1].length > maxLength) throw new Error('Chart action data unavailable');
  try { return JSON.parse(found[0][1]); }
  catch { throw new Error('Chart action data unavailable'); }
}

/** Project only the selected-item facts needed for an editable compose window. */
export function parseComposeSources(html, allowed) {
  if (typeof html !== 'string' || html.length > 1_000_000 || !allowed ||
      !Array.isArray(allowed.providerIds) || !Array.isArray(allowed.customerKeys)) {
    throw new Error('Chart action data unavailable');
  }
  const snapshot = readJsonScript(html, 'snapshotData', 700_000);
  const overlay = readJsonScript(html, 'providerVisitSourceOverlay', 200_000);
  if (snapshot?.schema !== 'arbys-local-exact-form-project-preview/v16' ||
      !Array.isArray(snapshot.projects) || snapshot.projects.length > 50 ||
      overlay?.schema !== 'ArbysProviderVisitSourceOverlay/v2' ||
      !overlay.rows || typeof overlay.rows !== 'object' || Array.isArray(overlay.rows) ||
      !Number.isFinite(Date.parse(overlay.observedAtUtc))) {
    throw new Error('Chart action data unavailable');
  }
  const providerIds = new Set(allowed.providerIds);
  const customerKeys = new Set(allowed.customerKeys);
  const providerById = Object.create(null);
  const providerDisplayById = Object.create(null);
  const customerByKey = Object.create(null);
  const seenProvider = new Set();
  const seenCustomer = new Set();
  for (const project of snapshot.projects) {
    if (!project || !Array.isArray(project.cases)) continue;
    if (customerKeys.has(project.caseKey)) {
      if (seenCustomer.has(project.caseKey)) throw new Error('Duplicate FORM project');
      seenCustomer.add(project.caseKey);
      if (FORM_KEY.test(project.caseKey) && STORE.test(project.formStore)) {
        customerByKey[project.caseKey] = Object.freeze({
          eligible: true, formSourceKey: project.caseKey, storeNumber: project.formStore,
        });
      }
    }
    for (const oneCase of project.cases) {
      if (!Array.isArray(oneCase?.workOrders)) continue;
      for (const wo of oneCase.workOrders) {
        if (!providerIds.has(wo?.id)) continue;
        if (seenProvider.has(wo.id)) throw new Error('Duplicate work order');
        seenProvider.add(wo.id);
        const row = overlay.rows[wo.id];
        const hold = value => value === '0' || value === 0 || value === false;
        const assignedSpName = wo.nativeFields?.['Assigned SP - Name'];
        const nativeAgentCode = typeof assignedSpName === 'string'
          ? assignedSpName.split(/[-_]/)[0].trim().toUpperCase() : null;
        if (!WO_ID.test(wo.id) || !NUMBER.test(wo.number) ||
            typeof wo.assignedSpAgentCode !== 'string' ||
            !AGENT.test(wo.assignedSpAgentCode) || !STORE.test(project.formStore) ||
            wo.woStore !== project.formStore ||
            wo.nativeFields?.['Store Number'] !== wo.woStore ||
            wo.nativeFields?.['Work Order ID'] !== wo.id.slice(0, 15) ||
            !ACN.test(wo.acn) || wo.nativeFields?.ACN !== wo.acn ||
            nativeAgentCode !== wo.assignedSpAgentCode.toUpperCase() ||
            wo.type !== 'Installation') continue;
        // The dated chart can explain a selection even when a later WO
        // overlay omits store, ACN, or provider identity. Display facts never
        // enter providerById, which remains the strict compose-source gate.
        if (/^\d{4}-\d{2}-\d{2}$/.test(snapshot.asOfDate) &&
            Number.isFinite(Date.parse(snapshot.asOfDate))) {
          providerDisplayById[wo.id] = Object.freeze({
            displayWoNumber: wo.number, storeNumber: project.formStore,
            agentCode: wo.assignedSpAgentCode.toUpperCase(),
            snapshotAsOfDate: snapshot.asOfDate,
          });
        }
        if (!PREINSTALL.has(wo.status) ||
            // The encrypted chart may omit Hold; the exact direct Thirsty
            // overlay must explicitly say unheld. Never ignore a conflicting
            // Hold value if the chart does contain one.
            (wo.nativeFields?.Hold !== undefined && !hold(wo.nativeFields.Hold)) || !row ||
            row.nativeWorkOrderId !== wo.id.slice(0, 15) ||
            row.workOrderNumber !== wo.number ||
            // A current visit status cannot authorize routing with a stale
            // chart-only store, ACN, or provider assignment. All three must
            // be present in the same direct Thirsty overlay as the Hold flag.
            row.storeNumber !== project.formStore ||
            row.outletAcn !== wo.acn ||
            typeof row.assignedSpAgentCode !== 'string' ||
            row.assignedSpAgentCode.toUpperCase() !== wo.assignedSpAgentCode.toUpperCase() ||
            row.workOrderType !== 'Installation' || row.activityType !== 'Installation' ||
            !PREINSTALL.has(row.status) || !hold(row.hold)) continue;
        const candidate = wo.providerContactCandidate;
        const suggestedRecipients = candidate?.state === 'two_source_file_candidate' &&
          typeof candidate.installManagerEmail === 'string' && EMAIL.test(candidate.installManagerEmail) &&
          typeof candidate.plannerEmail === 'string' && EMAIL.test(candidate.plannerEmail) &&
          candidate.installManagerEmail.toLowerCase() !== candidate.plannerEmail.toLowerCase()
          ? Object.freeze([candidate.installManagerEmail, candidate.plannerEmail])
          : Object.freeze([]);
        providerById[wo.id] = Object.freeze({
          eligible: true, nativeWoId: wo.id, displayWoNumber: wo.number,
          agentCode: wo.assignedSpAgentCode.toUpperCase(), type: 'Installation',
          storeNumber: project.formStore, outletAcn: wo.acn, status: row.status,
          spActivityDate: row.spActivityDate || null,
          sourceObservedAtUtc: overlay.observedAtUtc,
          suggestedRecipients,
        });
      }
    }
  }
  return Object.freeze({providerById: Object.freeze(providerById),
    providerDisplayById: Object.freeze(providerDisplayById),
    customerByKey: Object.freeze(customerByKey),
    snapshotAsOfDate: snapshot.asOfDate, overlayObservedAtUtc: overlay.observedAtUtc});
}
