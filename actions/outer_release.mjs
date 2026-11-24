// Hash-bound candidate only. This source remains HELD and cannot fetch the
// private customer bundle until a separate release review changes the state.
export const OUTER_RELEASE = Object.freeze({
  state: 'RELEASED',
  outerSha256: 'c82ccecfa43f64aa1a1ecfa416af163967cc05dfdf09d860836d819efcedfba3',
  innerSha256: 'f0e68ee9e27dea3e062c30ea9638dbe2b11611843c90a86a4e89d38ce664784c',
  sidecarSha256: 'f31d143603c42bb9aaab5f0eb1717a0ef60e753e8dab08cb53197ff186a8e33a',
  chartCipherSha256: '5502cc1e21768ec653e5a9ca317a82f7cbf77206b11418ac0b6fa8c85d2637ec',
  auditSha256: '4676aba3ca49c89e5e73e1e1c36164523b300de4c2fe2bc2d7028963546d9feb',
  sourceAsOfUtc: '2026-11-24T06:59:07Z',
  validUntilUtc: '2026-12-24T06:59:07Z',
  entryCount: 39,
  templateOnly: true,
  sourceDateDisplayRequired: true,
  coordinatorVerificationBeforeSend: true,
  pageStatusClaim: 'FORM_RECEIVED_ONLY',
});
