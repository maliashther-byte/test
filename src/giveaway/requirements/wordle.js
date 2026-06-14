export const LABEL = "Wordle Result";
export async function check(userId, opts = {}, client) {
  // Basic validation of a Wordle share-like string
  const res = opts.wordleResult ?? "";
  if (!res || typeof res !== "string" || res.length < 5) return { met: false, reason: "Invalid Wordle result" };
  return { met: true };
}

export default { LABEL, check };
