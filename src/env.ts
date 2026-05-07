import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv(cwd = process.cwd()): void {
  const envPath = resolve(cwd, '.env');
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Configure it in .env or your shell environment.`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return process.env[name] || fallback;
}
