import { check, dayCount, normalize, shiftDate, uid } from '../domain/itinerary.ts';
import { validateTrip } from '../domain/validateTrip.ts';
import type { Trip } from '../types.ts';
export function migrateTrip(value: unknown): Trip {
    const t = structuredClone(value) as Trip;
    validateTrip(t, false);
    const count = Math.max(t.days.length, dayCount(t.startDate, t.endDate));
    check(count <= 366, 'INVALID_INPUT', 'Too many days');
    t.days.sort((a, b) => a.day - b.day);
    while (t.days.length < count)
        t.days.push({ id: uid('day'), day: t.days.length + 1, date: shiftDate(t.startDate, t.days.length) });
    // Preserve user transport choices. Old cached geometry lacks reliable provider/transport provenance.
    t.segments = t.segments.map(s => ({ ...s, route: null, distance: undefined, duration: undefined, routeInfo: undefined }));
    t.revision = 1;
    const migrated = normalize(t);
    validateTrip(migrated);
    return migrated;
}
