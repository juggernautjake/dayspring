// ecosystem-core/social: the framework for sharing memories and people between users of the apps.
// NOT SWITCHED ON: importing this does nothing (no keys, no network, no timers). An app must opt in explicitly, and the
// only server adapter that can reach anything beyond this computer is disabled until a real server is set up.
// The spec is docs/SOCIAL.md.
export * from "./schema.mjs";
export { createState, makeOp, makeTombstoneOp, merge, mergeAll, get, all, isTombstoned, since, toJSON, fromJSON, createOutbox } from "./sync.mjs";
export { worldOf, nodeKey, parseNode } from "./world.mjs";
export { consentFor, audienceOf, canView, canViewProfile, canPool, canShare } from "./consent.mjs";
export { LINK_DEFAULTS, proposeLink, endorseLink, rejectLink, confirmBySubject, linkStatus, clusters, proposeClaim, vouchClaim, claimStatus } from "./links.mjs";
export { buildProfile, profileFor } from "./pooling.mjs";
export { SocialError, SHARE_DEFAULTS, makeShare, revokeOps, expireOps } from "./shares.mjs";
export { generateReminders } from "./reminders.mjs";
export { SCHEME, generateIdentity, publicOf, fingerprint, seal, open, openJSON, rewrap, wrapKey, unwrapKey, canonical, signBytes, verifyBytes, signOp, verifyOp, createKeyStore } from "./crypto.mjs";
export { createAuditLog, verifyChain } from "./audit.mjs";
export { createHub } from "./hub.mjs";
export { SocialAdapterError, ADAPTER_METHODS, isSocialAdapter, mockServerAdapter, httpServerAdapter } from "./adapter.mjs";
export { createSocialClient } from "./client.mjs";
