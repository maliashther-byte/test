export const LABEL = "Trivia Question";
export async function check(userId, opts = {}, client) {
  // opts.question and opts.answer may be provided. Validate if both exist.
  if (opts.question && opts.answer && opts.providedAnswer) {
    const correct = opts.providedAnswer.trim().toLowerCase() === opts.answer.trim().toLowerCase();
    return { met: !!correct, reason: correct ? undefined : "Wrong answer" };
  }
  return { met: false, reason: "No answer provided" };
}

export default { LABEL, check };
