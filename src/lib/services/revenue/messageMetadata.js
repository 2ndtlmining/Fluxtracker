// Permanent-message metadata for a revenue payment (issue #262). Pure.
//
// A permanent message is the on-chain record of an app spec being registered or updated,
// and it names the payment txid that paid for it. So a revenue transaction's txid finds its
// message exactly, and the message says:
//   - msg_type: 'register' (a new app) or 'update' (a renewal, extension or change)
//   - enterprise: whether the spec is encrypted (enterprise)
//   - expire_blocks: how many blocks the payment bought
//   - instances: how many instances were ordered

/** 'fluxappregister' -> 'register', 'fluxappupdate' -> 'update', anything else -> null. */
function messageType(type) {
  const t = String(type ?? '').toLowerCase();
  if (t.includes('register')) return 'register';
  if (t.includes('update')) return 'update';
  return null;
}

const wholeNumber = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/**
 * @param {object} msg one entry of /apps/permanentmessages
 * @returns {{txid: string, msg_type: string|null, enterprise: boolean, expire_blocks: number|null,
 *           instances: number|null}|null}  null when the message names no payment
 */
export function messageMetadata(msg) {
  if (!msg?.txid) return null;
  const spec = msg.appSpecifications || msg.zelAppSpecification || {};
  return {
    txid: msg.txid,
    msg_type: messageType(msg.type),
    // Encrypted specs carry a non-empty `enterprise` payload; open specs an empty string.
    enterprise: typeof spec.enterprise === 'string' ? spec.enterprise.length > 0 : Boolean(spec.enterprise),
    expire_blocks: wholeNumber(spec.expire),
    instances: wholeNumber(spec.instances)
  };
}

/** Index a permanentmessages payload by payment txid. */
export function indexMetadataByTxid(messages) {
  const byTxid = new Map();
  for (const msg of messages ?? []) {
    const meta = messageMetadata(msg);
    if (meta) byTxid.set(meta.txid, meta);
  }
  return byTxid;
}
