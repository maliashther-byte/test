export const LABEL = "Message Count";
export async function check(userId, opts = {}, client) {
  // opts.counts may be provided as a map of user message counts
  const counts = opts.counts ?? {};
  const min = opts.minMessages ?? 0;
  const userCount = counts[userId] ?? 0;
  if (userCount >= min) return { met: true };
  return { met: false, reason: `Need ${min} messages` };
}

export default { LABEL, check };
