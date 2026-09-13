import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function persistParseKey(key: string): Promise<void> {
  const file = path.join(process.cwd(), ".env.local");
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch {
    current = "";
  }
  const line = `PARSE_API_KEY=${key}`;
  if (/^PARSE_API_KEY=/m.test(current)) {
    current = current.replace(/^PARSE_API_KEY=.*$/m, line);
  } else {
    current = `${current.trimEnd()}\n${line}\n`;
  }
  await writeFile(file, current, "utf8");
}
