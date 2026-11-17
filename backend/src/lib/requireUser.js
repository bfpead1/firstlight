import { isAllowedEmail } from "../config.js";
import { db } from "../db/index.js";

/** The signed-in user, or null. Also drops sessions of accounts removed from ALLOWED_EMAILS. */
export async function sessionUser(req) {
  const user = req.session.userId ? await db.users.get(req.session.userId) : null;
  return user && isAllowedEmail(user.email) ? user : null;
}

/** Loads the signed-in user onto req.user, or responds 401. */
export async function requireUser(req, res, next) {
  const user = await sessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  req.user = user;
  next();
}
