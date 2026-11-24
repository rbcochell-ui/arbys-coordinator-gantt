// Hash-bound candidate only. This source remains HELD and cannot fetch the
// private customer bundle until a separate release review changes the state.
export const OUTER_RELEASE = Object.freeze({
  state: 'RELEASED',
  outerSha256: 'cd72419c76d5e4614b71e450630f2fafe33aacd12badcbc716133a56caa06a8d',
  innerSha256: 'e53ff6c9968a30a2d0acc1be86e3f5856c2f9d0de57296b3f5956fac0602e283',
  sidecarSha256: '21002e1ddc9e94f07cbc689810815d3e4bce8d78901c99200a7cefcc1edd29a5',
  chartCipherSha256: '5a94e1774d425bb9cffc3d52fb481369dcc7266fba5ed0a6a225e14178653f7c',
  auditSha256: '6c56618ee37ae3f594e1271b36619c216105d20241ca769c8af82ed75dd53005',
  sourceAsOfUtc: '2026-11-24T06:59:07Z',
  validUntilUtc: '2026-12-24T06:59:07Z',
  entryCount: 39,
  templateOnly: true,
  sourceDateDisplayRequired: true,
  coordinatorVerificationBeforeSend: true,
  pageStatusClaim: 'FORM_RECEIVED_ONLY',
});
