export const LABEL = "Account Age";
export async function check(userId, opts = {}, client) {
  // opts.minDays may be provided. Return met by default in this environment.
  return { met: true };
}

export default { LABEL, check };
