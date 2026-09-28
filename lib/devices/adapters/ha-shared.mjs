// The Home Assistant connector (lib/connectors/homeassistant.mjs), loaded when first needed. Tests swap it for a fake.
let mod = null;
export const haMod = async () => (mod ??= await import("../../connectors/homeassistant.mjs"));
export function _setHA(fake) { mod = fake; }
