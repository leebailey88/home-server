#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

import {
  DEFAULT_CBP_DASHBOARD_MARKER,
  DEFAULT_CBP_READ_ONLY_PATHS,
  isTenantDashboardUrl,
  shouldBlockSyntheticPrefetch,
} from '../lib/cbp-synthetic.mjs';

const stateFile =
  process.env.CBP_SYNTHETIC_STATE_FILE ||
  '/var/lib/home-server-synthetic-monitor/cbp-authenticated-smoke-state.json';
const baseUrl = process.env.CBP_SYNTHETIC_BASE_URL || 'https://communitybankpilot.com';
const tenantUrl = process.env.CBP_SYNTHETIC_TENANT_URL || '';
const tenantSlug = process.env.CBP_SYNTHETIC_TENANT_SLUG || '';
const email = process.env.CBP_SYNTHETIC_EMAIL || '';
const password = process.env.CBP_SYNTHETIC_PASSWORD || '';
const timeoutMs = Number.parseInt(process.env.CBP_SYNTHETIC_TIMEOUT_MS || '30000', 10);
const dashboardText =
  process.env.CBP_SYNTHETIC_EXPECT_DASHBOARD_TEXT || DEFAULT_CBP_DASHBOARD_MARKER;
const headless = process.env.CBP_SYNTHETIC_HEADLESS !== 'false';
const screenshotDir =
  process.env.CBP_SYNTHETIC_SCREENSHOT_DIR || '/var/log/home-server-synthetic-monitor';
const hostname = os.hostname();

const readOnlyPaths = (
  process.env.CBP_SYNTHETIC_READ_ONLY_PATHS || DEFAULT_CBP_READ_ONLY_PATHS.join(',')
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function requireEnv(name, value) {
  if (!value) throw new Error(`${name} is required.`);
}

function resolveTenantOrigin() {
  if (tenantUrl) return tenantUrl.replace(/\/$/, '');
  requireEnv('CBP_SYNTHETIC_TENANT_SLUG', tenantSlug);

  const parsed = new URL(baseUrl);
  if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') return parsed.origin;
  if (!parsed.hostname.startsWith(`${tenantSlug}.`))
    parsed.hostname = `${tenantSlug}.${parsed.hostname}`;
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return { status: 'unknown' };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
}

function getWebhook(status) {
  if (status === 'ok') {
    return (
      process.env.DISCORD_SYNTHETIC_MONITOR_RECOVERY_WEBHOOK_URL ||
      process.env.DISCORD_MONITOR_RECOVERY_WEBHOOK_URL ||
      process.env.DISCORD_WEBHOOK_URL ||
      ''
    );
  }
  return (
    process.env.DISCORD_SYNTHETIC_MONITOR_CRITICAL_WEBHOOK_URL ||
    process.env.DISCORD_MONITOR_CRITICAL_WEBHOOK_URL ||
    process.env.DISCORD_SYNTHETIC_MONITOR_WARNING_WEBHOOK_URL ||
    process.env.DISCORD_MONITOR_WARNING_WEBHOOK_URL ||
    process.env.DISCORD_WEBHOOK_URL ||
    ''
  );
}

async function sendDiscord({ status, severity, title, details }) {
  const webhookUrl = getWebhook(status);
  if (!webhookUrl) {
    console.error('No Discord webhook configured; skipping alert.');
    return;
  }

  const emoji = status === 'ok' ? '✅' : severity === 'critical' ? '🚨' : '⚠️';
  const content = [
    `${emoji} **${title}**`,
    `Status: ${status}`,
    `Severity: ${severity}`,
    'Service: cbp-authenticated-synthetic-monitor',
    `Host: ${hostname}`,
    '',
    details.slice(0, 1800),
  ].join('\n');

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
      // Discord message flag 1 << 2 (SUPPRESS_EMBEDS). Diagnostic URLs should
      // remain readable without causing Discord's crawler to probe protected tenants.
      flags: 4,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.error(`Discord webhook failed with ${response.status}: ${body}`);
  }
}

async function firstVisible(locator, label) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  throw new Error(`Could not find visible ${label}.`);
}

async function fillLoginForm(page) {
  const emailInput = await firstVisible(
    page.locator(
      'input[type="email"], input[name="email"], input[autocomplete="email"], input[placeholder*="email" i]',
    ),
    'email input',
  );
  await emailInput.fill(email);

  const passwordInput = await firstVisible(
    page.locator(
      'input[type="password"], input[name="password"], input[autocomplete="current-password"], input[placeholder*="password" i]',
    ),
    'password input',
  );
  await passwordInput.fill(password);

  const submit = page
    .locator('button[type="submit"], input[type="submit"], button')
    .filter({ hasText: /sign in|log in|login|continue/i })
    .first();

  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
    return;
  }

  await passwordInput.press('Enter');
}

async function assertPageHealthy(page, label) {
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs });
  const bodyText = (await page.locator('body').innerText({ timeout: timeoutMs })).trim();
  const lower = bodyText.toLowerCase();

  if (lower.includes('application error') || lower.includes('internal server error')) {
    throw new Error(`${label} rendered an application/server error.`);
  }
  if (lower.includes('sign in') && lower.includes('password') && !label.includes('login')) {
    throw new Error(`${label} appears to be a login page; session may not be authenticated.`);
  }
  if (bodyText.length < 80)
    throw new Error(`${label} body was unexpectedly short (${bodyText.length} chars).`);
  return bodyText;
}

async function takeFailureScreenshot(page) {
  try {
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(
      screenshotDir,
      `cbp-synthetic-failure-${new Date().toISOString().replaceAll(':', '-')}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
  } catch {
    return '';
  }
}

async function runSmoke() {
  requireEnv('CBP_SYNTHETIC_EMAIL', email);
  requireEnv('CBP_SYNTHETIC_PASSWORD', password);
  const origin = resolveTenantOrigin();
  const loginUrl = `${origin}/login`;
  const visited = [];
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
    userAgent: 'home-server-cbp-authenticated-synthetic-monitor/1.0',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (
      shouldBlockSyntheticPrefetch({
        method: request.method(),
        headers: request.headers(),
        url: request.url(),
      })
    ) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  try {
    console.log(`[synthetic:cbp] Opening ${loginUrl}`);
    const loginResponse = await page.goto(loginUrl, {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs,
    });
    if (!loginResponse || loginResponse.status() >= 400) {
      throw new Error(`Login page returned HTTP ${loginResponse?.status() ?? 'unknown'}.`);
    }
    visited.push(`login:${loginResponse.status()}`);

    await fillLoginForm(page);
    console.log('[synthetic:cbp] Waiting for authenticated dashboard');
    await page.waitForURL((url) => isTenantDashboardUrl(url, origin), { timeout: timeoutMs });
    await page
      .getByText(dashboardText, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs });

    const dashboardBody = await assertPageHealthy(page, 'dashboard');
    if (!dashboardBody.includes(dashboardText)) {
      throw new Error(`Dashboard did not contain expected text: ${JSON.stringify(dashboardText)}.`);
    }
    visited.push('dashboard:ok');

    for (const relativePath of readOnlyPaths) {
      const url = `${origin}${relativePath}`;
      console.log(`[synthetic:cbp] Opening ${url}`);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      if (!response || response.status() >= 400) {
        throw new Error(`${relativePath} returned HTTP ${response?.status() ?? 'unknown'}.`);
      }
      await assertPageHealthy(page, relativePath);
      visited.push(`${relativePath}:${response.status()}`);
    }

    return {
      ok: true,
      details: [
        `Origin: ${origin}`,
        `Tenant slug: ${tenantSlug || '(tenant URL override)'}`,
        `Dashboard marker: ${dashboardText}`,
        `Read-only paths: ${readOnlyPaths.join(', ')}`,
        `Visited: ${visited.join(' | ')}`,
      ].join('\n'),
    };
  } catch (error) {
    const screenshotPath = await takeFailureScreenshot(page);
    return {
      ok: false,
      error,
      details: [
        `Origin: ${origin}`,
        `Tenant slug: ${tenantSlug || '(tenant URL override)'}`,
        `Current URL: ${page.url()}`,
        `Error: ${error.message}`,
        screenshotPath ? `Screenshot: ${screenshotPath}` : '',
        `Visited: ${visited.join(' | ') || '(none)'}`,
      ]
        .filter(Boolean)
        .join('\n'),
    };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

const previous = loadState();
const startedAt = Date.now();
const result = await runSmoke();
const durationMs = Date.now() - startedAt;

if (!result.ok) {
  const details = `${result.details}\nDuration: ${durationMs}ms`;
  console.error(details);
  if (previous.status !== 'firing' || previous.lastError !== result.error.message) {
    await sendDiscord({
      status: 'firing',
      severity: 'critical',
      title: 'CBP authenticated synthetic check failed',
      details,
    });
  }
  saveState({
    status: 'firing',
    lastError: result.error.message,
    lastCheckedAt: new Date().toISOString(),
    durationMs,
  });
  process.exit(1);
}

const details = `${result.details}\nDuration: ${durationMs}ms`;
console.log(details);
if (previous.status === 'firing') {
  await sendDiscord({
    status: 'ok',
    severity: 'critical',
    title: 'CBP authenticated synthetic check recovered',
    details,
  });
}
saveState({ status: 'ok', lastError: '', lastCheckedAt: new Date().toISOString(), durationMs });
