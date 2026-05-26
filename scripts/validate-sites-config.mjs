#!/usr/bin/env node
import { loadSitesConfig } from './lib/sites-config.mjs';

const { enabledSites, selectedConfigPath } = loadSitesConfig();

console.log(`Validated ${enabledSites.length} enabled site(s) from ${selectedConfigPath}`);
