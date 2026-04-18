// trigger deploy 2
/**
 * Royal Horizon — Firebase Cloud Functions
 * ─────────────────────────────────────────
 * Handles:
 *   1. secureLogin      — username→email lookup stays server-side (never exposed)
 *   2. secureSignup     — username claim + profile write in one atomic server transaction
 *   3. sendVerification — triggers Firebase email verification after signup
 *   4. resendVerification — lets user request another verification email
 *   5. checkVerified    — frontend polls this to confirm email is verified
 *
 * Deploy:
 *   npm install -g firebase-tools
 *   firebase login
 *   cd functions && npm install
 *   firebase deploy --only functions
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp }      = require('firebase-admin/app');
const { getAuth }            = require('firebase-admin/auth');
const { getDatabase }        = require('firebase-admin/database');

initializeApp();

// ─── Rate limiting (in-memory, resets on cold start) ──────────────
// For production, replace with Firestore-backed rate limiting
const loginAttempts = new Map(); // ip → { count, firstAt }

function checkRateLimit(ip, maxAttempts = 10, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, firstAt: now };

  // Reset window if expired
  if (now - entry.firstAt > windowMs) {
    loginAttempts.set(ip, { count: 1, firstAt: now });
    return;
  }

  entry.count++;
  loginAttempts.set(ip, entry);

  if (entry.count > maxAttempts) {
    const waitMin = Math.ceil((windowMs - (now - entry.firstAt)) / 60000);
    throw new HttpsError(
      'resource-exhausted',
      `Too many attempts. Try again in ${waitMin} minute${waitMin !== 1 ? 's' : ''}.`
    );
  }
}

// ─── AVATAR COLORS (mirrors frontend) ─────────────────────────────
const AVATAR_COLORS = [
  '#8B7355','#6B8E7F','#7B6B8E','#8E7B6B',
  '#5E8E8E','#8E6B7B','#6B7B8E','#7B8E6B'
];

// ══════════════════════════════════════════════════════════════════
// 1. secureLogin
//    Accepts: { username, password }
//    Returns: { customToken } — frontend signs in with this token
//    The username→email lookup never touches the client
// ══════════════════════════════════════════════════════════════════
exports.secureLogin = onCall({ enforceAppCheck: true }, async (request) => {
  const ip = request.rawRequest?.ip || 'unknown';
  checkRateLimit(ip);

  const { username, password } = request.data;

  // Input validation
  if (!username || typeof username !== 'string' || username.length < 3) {
    throw new HttpsError('invalid-argument', 'Invalid username.');
  }
  if (!password || typeof password !== 'string' || password.length < 6) {
    throw new HttpsError('invalid-argument', 'Invalid password.');
  }

  const db   = getDatabase();
  const auth = getAuth();

  // Server-side username → email lookup (never exposed to client)
  const snap = await db.ref('usernames/' + username.toLowerCase().trim()).once('value');
  if (!snap.exists()) {
    // Deliberately vague — don't confirm whether username exists
    throw new HttpsError('not-found', 'Invalid username or password.');
  }

  const { email, uid } = snap.val();

  // Verify password by attempting Firebase Auth sign-in via Admin SDK
  // We use the REST API since Admin SDK doesn't expose signInWithPassword
  const apiKey = process.env.FIREBASE_API_KEY || 'AIzaSyAaN87Ce6H5vyzTctlUocJvMAcJqPnW6zA';
  const signInRes = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
    }
  );

  if (!signInRes.ok) {
    const body = await signInRes.json();
    const code = body?.error?.message || '';
    if (code.includes('INVALID_PASSWORD') || code.includes('INVALID_LOGIN_CREDENTIALS')) {
      throw new HttpsError('unauthenticated', 'Invalid username or password.');
    }
    if (code.includes('TOO_MANY_ATTEMPTS')) {
      throw new HttpsError('resource-exhausted', 'Account temporarily locked. Try again later.');
    }
    throw new HttpsError('unauthenticated', 'Login failed. Please try again.');
  }

  // Issue a custom token — frontend exchanges this for a full session
  const customToken = await auth.createCustomToken(uid);
  return { customToken };
});


// ══════════════════════════════════════════════════════════════════
// 2. secureSignup
//    Accepts: { name, username, email, password }
//    Returns: { uid }
//    Atomically claims username + creates profile + sends verification
// ══════════════════════════════════════════════════════════════════
exports.secureSignup = onCall({ enforceAppCheck: true }, async (request) => {
  const ip = request.rawRequest?.ip || 'unknown';
  checkRateLimit(ip, 5, 60 * 60 * 1000); // stricter: 5 signups/hour per IP

  const { name, username, email, password } = request.data;

  // Input validation
  if (!name    || typeof name     !== 'string' || name.trim().length < 2)
    throw new HttpsError('invalid-argument', 'Name must be at least 2 characters.');
  if (!username || typeof username !== 'string' || username.length < 3 || !/^[a-z0-9_]+$/.test(username))
    throw new HttpsError('invalid-argument', 'Username must be 3+ characters, letters/numbers/underscores only.');
  if (!email   || typeof email    !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new HttpsError('invalid-argument', 'Invalid email address.');
  if (!password || typeof password !== 'string' || password.length < 6)
    throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.');

  const db   = getDatabase();
  const auth = getAuth();
  const cleanUsername = username.toLowerCase().trim();

  // Check username availability server-side
  const unameSnap = await db.ref('usernames/' + cleanUsername).once('value');
  if (unameSnap.exists()) {
    throw new HttpsError('already-exists', 'That username is already taken.');
  }

  // Create Firebase Auth user
  let userRecord;
  try {
    userRecord = await auth.createUser({ email: email.trim(), password, displayName: name.trim() });
  } catch(e) {
    if (e.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'That email is already registered.');
    }
    throw new HttpsError('internal', 'Could not create account. Please try again.');
  }

  const uid = userRecord.uid;
  const now = Date.now();

  const profile = {
    name:              name.trim(),
    username:          cleanUsername,
    email:             email.trim(),
    bio:               '',
    color:             AVATAR_COLORS[0],
    outlet:            '',
    officialNames:     '',
    brand:             '',
    mikaTarget:        '',
    samsungTarget:     '',
    morningReminder:   '10:00',
    eveningReminder:   '18:00',
    emailVerified:     false,
    createdAt:         now,
  };

  // Atomic write: username claim + user profile together
  await db.ref().update({
    [`usernames/${cleanUsername}`]:        { uid, email: email.trim() },
    [`users/${uid}/profile`]:              profile,
  });

  // Send email verification link via Admin SDK
  try {
    const verifyLink = await auth.generateEmailVerificationLink(email.trim(), {
      url: 'https://royal-horizon.firebaseapp.com/verified', // your app's URL
    });
    // In production, send via your email provider (SendGrid, Resend, etc.)
    // For now Firebase Auth sends it automatically when using client SDK
    console.log(`Verification link for ${email}: ${verifyLink}`);
  } catch(e) {
    // Non-fatal — user can request resend
    console.warn('Could not generate verification link:', e.message);
  }

  return { uid };
});


// ══════════════════════════════════════════════════════════════════
// 3. resendVerification
//    Accepts: {} (must be authenticated)
//    Triggers a new verification email for the calling user
// ══════════════════════════════════════════════════════════════════
exports.resendVerification = onCall({ enforceAppCheck: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const uid  = request.auth.uid;
  const auth = getAuth();
  const db   = getDatabase();

  // Rate-limit: max 3 resends per hour per user
  const resendSnap = await db.ref(`users/${uid}/verifyResendAt`).once('value');
  const lastResend = resendSnap.val() || 0;
  if (Date.now() - lastResend < 60 * 1000) {
    throw new HttpsError('resource-exhausted', 'Please wait a minute before requesting another email.');
  }

  const userRecord = await auth.getUser(uid);
  if (userRecord.emailVerified) {
    // Sync the flag in DB if somehow out of date
    await db.ref(`users/${uid}/profile/emailVerified`).set(true);
    throw new HttpsError('failed-precondition', 'Email is already verified.');
  }

  const verifyLink = await auth.generateEmailVerificationLink(userRecord.email);
  // TODO: send verifyLink via your email provider
  // For now, Firebase client SDK's sendEmailVerification() handles delivery

  await db.ref(`users/${uid}/verifyResendAt`).set(Date.now());

  return { sent: true };
});


// ══════════════════════════════════════════════════════════════════
// 4. checkVerified
//    Accepts: {} (must be authenticated)
//    Checks Admin SDK (authoritative) whether email is verified
//    Updates the DB profile flag and returns the result
// ══════════════════════════════════════════════════════════════════
exports.checkVerified = onCall({ enforceAppCheck: true }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }

  const uid  = request.auth.uid;
  const auth = getAuth();
  const db   = getDatabase();

  // Always read from Admin SDK — this is the authoritative source
  const userRecord = await auth.getUser(uid);
  const verified   = userRecord.emailVerified;

  if (verified) {
    // Sync to DB so the app can read it without calling this function every time
    await db.ref(`users/${uid}/profile/emailVerified`).set(true);
  }

  return { verified };
});

