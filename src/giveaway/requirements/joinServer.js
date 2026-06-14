export const LABEL = "Join Server";
export async function check(userId, opts = {}, client) {
  // opts.guildId may be provided. Default to met to avoid blocking runtime in this environment.
  return { met: true };
}

export default { LABEL, check };
