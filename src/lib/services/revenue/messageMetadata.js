// Permanent-message metadata for a revenue payment (issue #262). Pure.

import { resolveGameFromAppName, categorizeImage, getCanonicalName } from '../../config.js';
//
// A permanent message is the on-chain record of an app spec being registered or updated,
// and it names the payment txid that paid for it. So a revenue transaction's txid finds its
// message exactly, and the message says:
//   - msg_type: 'register' (a new app) or 'update' (a renewal, extension or change)
//   - enterprise: whether the spec is encrypted (enterprise)
//   - expire_blocks: how many blocks the payment bought
//   - instances: how many instances were ordered
//   - game_name: the game the app is (issue #395) -- from its game-site name, or else from a
//     game image in its spec (hand-named servers like `rustserver`); null when neither says

/** 'fluxappregister' -> 'register', 'fluxappupdate' -> 'update', anything else -> null. */
export function messageType(type) {
  const t = String(type ?? '').toLowerCase();
  if (t.includes('register')) return 'register';
  if (t.includes('update')) return 'update';
  return null;
}

/** The container images a spec runs: its compose components, or a legacy single repotag. */
function specImages(spec) {
  if (Array.isArray(spec?.compose)) return spec.compose.map(c => c?.repotag).filter(Boolean);
  return spec?.repotag ? [spec.repotag] : [];
}

/**
 * Which game an app is, or null (issue #395). The game-site name wins -- it survives spec
 * encryption; otherwise the first image the dashboard categorises as gaming, by its canonical
 * name ("Rust", "Minecraft"). Companion website images are excluded by categorizeImage.
 */
export function gameFromSpec(spec) {
  const byName = resolveGameFromAppName(spec?.name);
  if (byName) return byName;
  const image = specImages(spec).find(i => categorizeImage(i) === 'gaming');
  return image ? getCanonicalName(image) : null;
}

const wholeNumber = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/**
 * @param {object} msg one entry of /apps/permanentmessages
 * @returns {{txid: string, msg_type: string|null, enterprise: boolean, expire_blocks: number|null,
 *           instances: number|null, game_name: string|null}|null}  null when the message names no payment
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
    instances: wholeNumber(spec.instances),
    game_name: gameFromSpec(spec)
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
