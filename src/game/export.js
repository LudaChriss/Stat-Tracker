// Manual backup. localStorage lives in exactly one browser on one phone, so
// this is the only way the season survives clearing site data or a new device.

export const EXPORT_VERSION = 1;

/** The durable season: everything you'd need to reconstruct the app's state. */
export function buildExport(s) {
  return {
    app: 'rec-league-stat-tracker',
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    myTeam: s.myTeam,
    roster: s.roster,
    teams: s.teams,
    history: s.history,
  };
}

export function exportFilename(s, date = new Date()) {
  const team = (s.myTeam.name || 'season')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'season';
  return `${team}-${date.toISOString().slice(0, 10)}.json`;
}

/**
 * Hand the file to the user. Order matters on iOS: the share sheet is the only
 * route that reliably reaches Files / AirDrop / Mail from a home-screen PWA,
 * where an <a download> can silently do nothing. Falls back to a download, then
 * to the clipboard.
 *
 * Must be called directly from a tap — browsers block both share and download
 * outside a user gesture.
 */
export async function saveSeasonFile(s) {
  const text = JSON.stringify(buildExport(s), null, 2);
  const filename = exportFilename(s);

  if (typeof File !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const file = new File([text], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: filename });
        return 'shared';
      }
    } catch (err) {
      // The user dismissing the share sheet is not a failure.
      if (err && err.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
  } catch {
    /* fall through to the clipboard */
  }

  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
