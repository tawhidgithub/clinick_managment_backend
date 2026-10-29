// Creates an admin login from the command line, or turns an existing account
// into an active admin with a new password (for when nobody can sign in).
//
//   npm run create-admin
//   npm run create-admin -- --username rahim --name "Rahim Uddin"
//
// Uses the same username and password rules as Settings > Staff.
import 'dotenv/config';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import type { z } from 'zod';
import { prisma } from '../src/shared/db/prisma';
import { hashPassword, revokeAllSessions } from '../src/modules/auth';
import { createStaffBody } from '../src/modules/staff/staff.schema';

const fields = createStaffBody.shape;

const { values: args } = parseArgs({
  options: { username: { type: 'string' }, name: { type: 'string' } },
});

// Typed characters are echoed through this stream, so muting it hides passwords.
let muted = false;
const echo = new Writable({
  write(chunk, encoding, done) {
    if (!muted) process.stdout.write(chunk, encoding);
    done();
  },
});
const rl = createInterface({ input: process.stdin, output: echo, terminal: process.stdin.isTTY });
rl.on('SIGINT', () => {
  process.stdout.write('\nCancelled\n');
  process.exit(130);
});
// The iterator buffers lines, so answers piped in all at once are not lost.
const lines = rl[Symbol.asyncIterator]();

async function ask(question: string, { hidden = false } = {}): Promise<string> {
  process.stdout.write(question);
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden && process.stdin.isTTY) process.stdout.write('\n');
  if (done) throw new Error('No input');
  return value;
}

type Rule = z.ZodType<string>;

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid value';
}

/** Validates a value given as a command-line flag. */
function checkFlag(flag: string, rule: Rule, value: string): string {
  const result = rule.safeParse(value);
  if (!result.success) throw new Error(`--${flag}: ${firstIssue(result.error)}`);
  return result.data;
}

/** Asks until the answer passes `rule`; `fallback` is used for an empty answer. */
async function askValid(
  question: string,
  rule: Rule,
  { fallback, hidden = false }: { fallback?: string; hidden?: boolean } = {},
): Promise<string> {
  for (;;) {
    const answer = (await ask(question, { hidden })) || fallback || '';
    const result = rule.safeParse(answer);
    if (result.success) return result.data;
    console.log(`  ${firstIssue(result.error)}`);
  }
}

async function askNewPassword(): Promise<string> {
  for (;;) {
    const password = await askValid('Password: ', fields.password, { hidden: true });
    if ((await ask('Repeat password: ', { hidden: true })) === password) return password;
    console.log('  Passwords do not match, try again');
  }
}

async function main() {
  const username = args.username
    ? checkFlag('username', fields.username, args.username)
    : await askValid('Username: ', fields.username);

  const existing = await prisma.user.findUnique({ where: { username } });

  if (!existing) {
    const name = args.name
      ? checkFlag('name', fields.name, args.name)
      : await askValid('Full name [Administrator]: ', fields.name, { fallback: 'Administrator' });
    const passwordHash = await hashPassword(await askNewPassword());
    await prisma.user.create({ data: { username, name, role: 'ADMIN', passwordHash } });
    console.log(`Created admin "${username}" (${name}). Sign in and use Settings > Staff for anything else.`);
    return;
  }

  const status = existing.isActive ? 'active' : 'inactive';
  console.log(`"${username}" already exists: ${existing.name}, ${existing.role}, ${status}.`);
  const confirm = await ask('Make it an active admin with a new password? (y/N): ');
  if (!/^y(es)?$/i.test(confirm.trim())) {
    console.log('Nothing changed');
    return;
  }
  const passwordHash = await hashPassword(await askNewPassword());
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: existing.id },
      data: { role: 'ADMIN', isActive: true, passwordHash },
    });
    // Old sign-ins end, as when an admin resets a password from Settings.
    await revokeAllSessions(existing.id, tx);
  });
  console.log(`"${username}" is now an active admin with the new password. Other devices were signed out.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    rl.close();
    await prisma.$disconnect();
  });
