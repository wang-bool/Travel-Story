// Optional network fixture ONLY for disposable integration servers.
// Usage: TRAVEL_STORY_DATA_DIR=/tmp/travel-story-mcp.* node --import ./scripts/smoke-provider.mjs ...
if (!process.env.TRAVEL_STORY_DATA_DIR?.startsWith('/tmp/travel-story-mcp.'))
    throw new Error('Provider fixtures require disposable data');
process.env.LOCATIONIQ_KEY = 'integration-fixture';
process.env.GAODE_KEY = '';
const original = globalThis.fetch;
globalThis.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (['eu1.locationiq.com', 'us1.locationiq.com'].includes(url.hostname) && url.pathname.endsWith('/search')) {
        if (!url.searchParams.get('q')?.includes('__TRAVEL_STORY_SMOKE_PLACE__'))
            return Response.json([]);
        return Response.json([{ place_id: 9911001, name: 'Integration fixture', display_name: 'Integration fixture, Paris, France', lat: '48.8606', lon: '2.3376', class: 'tourism', type: 'museum', namedetails: { 'name:zh': '联调新增地点' }, address: { city: 'Paris', country: 'France', country_code: 'fr' } }]);
    }
    if (url.hostname === 'router.project-osrm.org') {
        const points = url.pathname.split('/').at(-1).split(';').map(p => p.split(',').map(Number));
        return Response.json({ code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: points }, distance: 1500, duration: 300 }] });
    }
    return original(input, init);
};
