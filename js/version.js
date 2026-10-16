// The app's version. Keep equal to "version" in package.json (a test checks);
// raising it and pushing publishes a new desktop release that installed apps
// offer as an update.
export const APP_VERSION = '1.78.0';

// Returns true only if remote is strictly newer than local in semver.
export function isNewerVersion(remote, local) {
  if (!remote || !local) return false;
  const clean = (v) => String(v).trim().replace(/^v/i, '');
  const [rParts, rPre] = clean(remote).split('-');
  const [lParts, lPre] = clean(local).split('-');
  const rNums = rParts.split('.').map((n) => parseInt(n, 10) || 0);
  const lNums = lParts.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(rNums.length, lNums.length, 3);
  for (let i = 0; i < len; i++) {
    const r = rNums[i] || 0;
    const l = lNums[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  if (!rPre && lPre) return true;
  if (rPre && !lPre) return false;
  if (rPre && lPre) return rPre.localeCompare(lPre) > 0;
  return false;
}

