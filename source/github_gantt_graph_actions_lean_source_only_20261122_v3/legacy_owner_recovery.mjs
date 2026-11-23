import {LegacyHold, LegacyReopenAdapter} from './legacy_reopen.mjs';
import {recordLegacySentOnce} from './legacy_sent_receipt.mjs';

const held = (dispatchKey, reason = 'OWNER_RECONCILIATION_REQUIRED') =>
  Object.freeze({status: 'legacy_occupied', dispatchKey, reason,
    webLink: null, sendReady: false});
const unresolved = (dispatchKey, reason = 'LEGACY_EVIDENCE_UNVERIFIED') =>
  Object.freeze({status: 'unresolved', dispatchKey, reason,
    webLink: null, sendReady: false});

/**
 * Optional owner-only route for the two migrated historical drafts. It never
 * creates an Outlook draft. The selected pilot key stays occupied on every
 * absent, changed, or partial proof. Check Sent may append one exact List
 * receipt through the injected selected-List POST port after two owner reads.
 */
export class LegacyOwnerRecovery {
  // A lost write response remains terminal within this loaded runtime. The
  // persisted SentAttempt row provides the cross-session fence.
  #sentWriteAttemptedKeys = new Set();
  #sentFinalAttemptedKeys = new Set();

  constructor({adapter, postSentReceipt = null,
      now = () => Date.now()} = {}) {
    if (!(adapter instanceof LegacyReopenAdapter) ||
        postSentReceipt !== null && typeof postSentReceipt !== 'function' ||
        typeof now !== 'function') {
      throw new TypeError('Reviewed owner adapter and optional List port required');
    }
    this.adapter = adapter;
    this.postSentReceipt = postSentReceipt;
    this.now = now;
  }

  async _read(dispatchKey) {
    try { return await this.adapter.reopen(dispatchKey); }
    catch (error) {
      if (error instanceof LegacyHold) return null;
      throw error;
    }
  }

  async preview(dispatchKey) {
    const result = await this._read(dispatchKey);
    if (!result || result.status === 'legacy_occupied' ||
        result.status === 'sent_observed_unlogged') return held(dispatchKey);
    if (result.status === 'legacy_draft_review_required') {
      return Object.freeze({status: 'draft_occupied', dispatchKey,
        webLink: null, sendReady: false});
    }
    if (result.status === 'sent' || result.status === 'sent_with_changes') {
      return Object.freeze({status: result.status, dispatchKey,
        webLink: null, sendReady: false});
    }
    return held(dispatchKey);
  }

  async reopen(dispatchKey) {
    const result = await this._read(dispatchKey);
    if (!result) return unresolved(dispatchKey);
    if (result.status === 'sent_observed_unlogged') {
      return unresolved(dispatchKey, 'SENT_RECEIPT_REQUIRED');
    }
    return Object.freeze({...result, dispatchKey});
  }

  async checkSent(dispatchKey) {
    const result = await this._read(dispatchKey);
    if (!result) return unresolved(dispatchKey);
    if (result.status !== 'sent_observed_unlogged') {
      return Object.freeze({...result, dispatchKey});
    }
    if (!this.postSentReceipt) {
      return unresolved(dispatchKey, 'SENT_RECEIPT_PORT_UNAVAILABLE');
    }
    if (this.#sentWriteAttemptedKeys.has(dispatchKey)) {
      return unresolved(dispatchKey, 'SENT_RECEIPT_RECONCILIATION_REQUIRED');
    }
    const postOnce = (fields, readRefs, beforeFetch) => {
      // Set synchronously before token/HTTP work. Only one caller may reserve
      // the marker; only that caller may attempt its one final Sent POST.
      if (fields.Kind === 'SentAttempt') {
        if (this.#sentWriteAttemptedKeys.has(dispatchKey)) {
          throw new LegacyHold('LEGACY_SENT_WRITE_ALREADY_ATTEMPTED');
        }
        this.#sentWriteAttemptedKeys.add(dispatchKey);
      } else if (fields.Kind === 'Sent') {
        if (!this.#sentWriteAttemptedKeys.has(dispatchKey) ||
            this.#sentFinalAttemptedKeys.has(dispatchKey)) {
          throw new LegacyHold('LEGACY_SENT_WRITE_ALREADY_ATTEMPTED');
        }
        this.#sentFinalAttemptedKeys.add(dispatchKey);
      } else {
        throw new LegacyHold('LEGACY_SENT_KIND_INVALID');
      }
      return this.postSentReceipt(fields, readRefs, beforeFetch);
    };
    try {
      const recorded = await recordLegacySentOnce(this.adapter, dispatchKey,
        postOnce, {now: this.now});
      return Object.freeze({...recorded, dispatchKey});
    } catch (error) {
      if (error instanceof LegacyHold) {
        return unresolved(dispatchKey,
          'SENT_RECEIPT_RECONCILIATION_REQUIRED');
      }
      throw error;
    }
  }
}
