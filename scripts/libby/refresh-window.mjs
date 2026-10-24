#!/usr/bin/env node
// Used by .github/workflows/refresh-data.yml to decide whether this run is one of the update times.
// GitHub's timer only understands UTC, and London moves between UTC and UTC+1, so the workflow wakes every hour and asks here.
// Prints "go=true" or "go=false" (the format GitHub reads into a step output). Times live in lib/schedule.js.
//   node scripts/refresh-window.mjs           the real answer for now
//   node scripts/refresh-window.mjs --force   always go (for runs started by hand)

import { isRefreshHour, londonClock } from '../../lib/libby/schedule.js';

const go = process.argv.includes('--force') || isRefreshHour();
const { hour, minute } = londonClock();
console.error(`London time is ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}: ${go ? 'this is an update time' : 'not an update time, nothing to do'}`);
console.log(`go=${go}`);
