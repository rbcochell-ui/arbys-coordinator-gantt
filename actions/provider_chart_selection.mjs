// A narrow chart identity check for the direct Outlook template. The old
// helper projection requires native field copies absent for this F32 row, so
// this check reads the one selected high-level chart WO and rejects conflict.
const WO = /^0WO[A-Za-z0-9]{15}$/u;
const SNAPSHOT_RE =
  /<script type="application\/json" id="snapshotData">([^<]+)<\/script>/gu;

export function assertSelectedProviderChartIdentity(html, allowed,
    selectedNativeWoId, source) {
  if (typeof html !== 'string' || html.length > 800_000 ||
      typeof selectedNativeWoId !== 'string' ||
      !WO.test(selectedNativeWoId) ||
      !allowed?.providerIds?.includes(selectedNativeWoId)) {
    throw new Error('Selected work order is not in this chart');
  }
  const scripts = [...html.matchAll(SNAPSHOT_RE)];
  if (scripts.length !== 1 || scripts[0][1].length > 700_000) {
    throw new Error('Chart source unavailable');
  }
  let snapshot;
  try { snapshot = JSON.parse(scripts[0][1]); }
  catch { throw new Error('Chart source unavailable'); }
  if (snapshot?.schema !== 'arbys-local-exact-form-project-preview/v16' ||
      !Array.isArray(snapshot.projects) || snapshot.projects.length > 50) {
    throw new Error('Chart source unavailable');
  }
  const rows = [];
  for (const project of snapshot.projects) {
    for (const oneCase of project?.cases ?? []) {
      for (const wo of oneCase?.workOrders ?? []) {
        if (wo?.id === selectedNativeWoId) rows.push({project, wo});
      }
    }
  }
  if (rows.length !== 1 || !source ||
      source.nativeWoId !== selectedNativeWoId) {
    throw new Error('Work order identity mismatch');
  }
  const {project, wo} = rows[0];
  const candidate = wo.providerContactCandidate;
  const native = wo.nativeFields ?? {};
  const nonconflict = (value, expected) =>
    value === undefined || value === expected;
  if (project.formStore !== source.storeNumber ||
      wo.woStore !== source.storeNumber ||
      wo.number !== source.workOrderNumber ||
      wo.acn !== source.acn ||
      wo.assignedSpAgentCode !== source.agentCode ||
      wo.type !== source.workOrderType ||
      wo.status !== source.status ||
      !nonconflict(native['Store Number'], source.storeNumber) ||
      !nonconflict(native.ACN, source.acn) ||
      !nonconflict(native['Work Order ID'], selectedNativeWoId.slice(0, 15)) ||
      !nonconflict(native.Hold, source.hold) ||
      candidate?.state !== 'two_source_file_candidate' ||
      candidate.installManagerEmail?.toLowerCase() !==
        source.installManagerEmail.toLowerCase() ||
      candidate.plannerEmail?.toLowerCase() !==
        source.plannerEmail.toLowerCase()) {
    throw new Error('Work order chart and protected source disagree');
  }
  return Object.freeze({selectedNativeWoId,
    storeNumber: source.storeNumber, acn: source.acn,
    agentCode: source.agentCode, status: source.status});
}
