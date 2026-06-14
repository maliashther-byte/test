export const LABEL = "Has Role";
export async function check(userId, opts = {}, client) {
  // opts.roleId may be provided. Return met by default here.
  return { met: true };
}

export default { LABEL, check };
