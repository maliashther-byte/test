export const LABEL = "Short Answer";
export async function check(userId, opts = {}, client) {
  // This requirement is typically manual review; return not met by default.
  return { met: false, reason: "Requires host review" };
}

export default { LABEL, check };
