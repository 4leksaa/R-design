'use strict';
/**
 * Creates (or resets the password of) an admin user.
 *   npm run create-admin -- you@example.com
 * The password is asked for interactively (not shown, not stored in shell history).
 * For automation you can set ADMIN_EMAIL and ADMIN_PASSWORD instead.
 */
const readline = require('readline');
const { createAdmin } = require('../auth');

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write(s.replace(/[^\r\n]/g, '')); };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

(async () => {
  const email = process.env.ADMIN_EMAIL || process.argv[2] || (await ask('Admin email: '));
  const password = process.env.ADMIN_PASSWORD || (await ask('Password (min 12 characters): ', true));
  try {
    const r = await createAdmin(email, password);
    console.log(r.updated ? `Password updated for ${r.email}.` : `Admin created: ${r.email}. Sign in at /admin/`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
})();
