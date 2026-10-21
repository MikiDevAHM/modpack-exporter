import { app, session } from 'electron';
import path from 'path';
import fs from 'fs';
import { SANDBOX_ROOT, store } from './store';

export const isSandbox = typeof __SANDBOX__ !== 'undefined' && __SANDBOX__;

export function sandboxRoot(): string {
  return SANDBOX_ROOT;
}

/** Resolve a path and ensure it stays inside the sandbox root. Throws if it escapes. */
import { resolveSandboxPath as resolvePath } from './sandboxPath';

export function resolveSandboxPath(input: string): string {
  return resolvePath(input, SANDBOX_ROOT);
}

/** Guard an arbitrary path against traversal/symlink escape. */
export function assertInsideSandbox(input: string): void {
  resolveSandboxPath(input);
}

let guardViolations: { kind: string; detail: string; at: string }[] = [];

export function recordViolation(kind: string, detail: string): void {
  guardViolations.push({ kind, detail, at: new Date().toISOString() });
  console.error(`[sandbox-guard] ${kind}: ${detail}`);
}

export function getGuardViolations(): { kind: string; detail: string; at: string }[] {
  return [...guardViolations];
}

export function resetGuardViolations(): void {
  guardViolations = [];
}

/** Install the network guard: cancel any non-loopback/file request. */
export function installNetworkGuard(): void {
  if (!isSandbox) return;
  try {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = details.url || '';
      const allowed =
        url.startsWith('file:') ||
        url.startsWith('devtools:') ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url);
      if (!allowed) {
        recordViolation('network', url);
        callback({ cancel: true });
        return;
      }
      callback({});
    });
  } catch (e) {
    recordViolation('network-setup', String(e));
  }
}

/** Ensure the sandbox root and a fake profile dir exist. */
export function ensureSandboxRoot(): void {
  if (!isSandbox) return;
  try {
    fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
    const profile = path.join(SANDBOX_ROOT, 'profile');
    fs.mkdirSync(path.join(profile, 'mods'), { recursive: true });
    fs.mkdirSync(path.join(profile, 'overrides', 'config'), { recursive: true });
    if (!store.get('modpackRoot')) {
      store.set('modpackRoot', profile);
    }
  } catch (e) {
    recordViolation('fs-setup', String(e));
  }
}

/** Wrap fetch to block non-fake hosts in sandbox mode. */
export function guardedFetch(input: any, init?: RequestInit): Promise<Response> {
  if (isSandbox) {
    const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url);
    const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url);
    if (!allowed) {
      recordViolation('fetch', url);
      throw new Error(`Sandbox network guard blocked: ${url}`);
    }
  }
  return fetch(input as any, init);
}
