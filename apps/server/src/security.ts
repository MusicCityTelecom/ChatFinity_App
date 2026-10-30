import {
  scrypt as rawScrypt,
  randomBytes,
  createHash,
  timingSafeEqual,
} from "node:crypto";
// 64 MiB, r=8, p=2; bound concurrent derivations to avoid unbounded memory use.
let active = 0;
const waiters: Array<() => void> = [];
async function scrypt(password: string, salt: string): Promise<Buffer> {
  if (active >= 4) {
    if (waiters.length >= 20)
      fail(429, "Sign-in is busy. Please try again shortly.");
    await new Promise<void>((resolve) => waiters.push(resolve));
  } else {
    active++;
  }
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      rawScrypt(
        password,
        salt,
        64,
        { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 },
        (err, key) => (err ? reject(err) : resolve(key)),
      ),
    );
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}
export const secret = () => randomBytes(32).toString("base64url");
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${((await scrypt(password, salt)) as Buffer).toString("hex")}`;
}
export async function passwordMatches(password: string, encoded: string) {
  const [salt, key] = encoded.split(":");
  if (!salt || !key) return false;
  const candidate = (await scrypt(password, salt)) as Buffer;
  const expected = Buffer.from(key, "hex");
  return (
    expected.length === candidate.length && timingSafeEqual(candidate, expected)
  );
}
export function fail(statusCode: number, message: string): never {
  throw Object.assign(new Error(message), { statusCode });
}
