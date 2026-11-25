import { useState } from 'react';
import { Alert, Button } from '../ui';
import { deviceZone, safeZone } from '../../lib/clock';
import { usePreferences, useUpdatePreferences } from '../../api/hooks';

/**
 * Existing accounts created with the old "UTC" default would show the previous calendar day for hours after local midnight.
 * Never changed silently: we only offer a one-click switch when the stored zone is UTC and the device is somewhere else.
 */
export function TimeZoneNotice() {
  const prefs = usePreferences(); const update = useUpdatePreferences(); const [dismissed, setDismissed] = useState(false);
  const device = deviceZone();
  if (dismissed || !prefs.data || prefs.data.timeZone !== 'UTC' || device === 'UTC' || safeZone(device) !== device) return null;
  return (
    <Alert tone="warning" className="mb-4">
      <div className="flex flex-wrap items-center gap-3">
        <span>Your time zone is set to <strong>UTC</strong>, but this device is in <strong>{device}</strong>. Dates on the dashboard can show the previous day after local midnight.</span>
        <Button size="sm" loading={update.isPending} onClick={() => update.mutate({ timeZone: device })}>Use {device}</Button>
        <Button size="sm" variant="secondary" onClick={() => setDismissed(true)}>Keep UTC</Button>
      </div>
    </Alert>
  );
}
