/**
 * Fetches NYC Open Data (and similar) JSON datasets and writes them to S3.
 * Run daily via EventBridge to keep the cache fresh.
 * Set env: CACHE_BUCKET (required).
 *
 * Uses AWS SDK v2 (included in Lambda Node runtime). Package as zip with this file only.
 */

const AWS = require('aws-sdk');
const https = require('https');

const DATASETS = [
  { slug: '311-service-requests', url: 'https://data.cityofnewyork.us/resource/erm2-nwe9.json?$limit=5000' },
  { slug: 'nyc-subway-entrances', url: 'https://data.ny.gov/resource/i9wp-a4ja.json?$limit=5000' },
  { slug: 'film-permits', url: 'https://data.cityofnewyork.us/resource/tg4x-b46p.json?$limit=5000' },
  { slug: 'nyc-jobs', url: 'https://data.cityofnewyork.us/resource/kpav-sd4t.json?$limit=5000' },
  { slug: 'nyc-motor-vehicle-collisions', url: 'https://data.cityofnewyork.us/resource/h9gi-nx95.json?$limit=5000' },
  { slug: 'street-tree-census', url: 'https://data.cityofnewyork.us/resource/uvpi-gqnh.json?$limit=5000' },
  { slug: 'covid-19-data', url: 'https://data.cityofnewyork.us/resource/rc75-m7u3.json?$limit=5000' },
  { slug: 'restaurant-inspection-results', url: 'https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=5000' },
];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 60000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

exports.handler = async (event, context) => {
  const BUCKET = process.env.CACHE_BUCKET;
  const PREFIX = process.env.CACHE_PREFIX || 'datasets';

  if (!BUCKET) {
    throw new Error('CACHE_BUCKET environment variable is required');
  }

  const s3 = new AWS.S3();
  const results = { ok: [], failed: [] };

  for (const { slug, url } of DATASETS) {
    try {
      const data = await fetchJson(url);
      if (!Array.isArray(data)) throw new Error('Response is not a JSON array');

      const key = `${PREFIX}/${slug}.json`;
      await s3.putObject({
        Bucket: BUCKET,
        Key: key,
        Body: JSON.stringify(data),
        ContentType: 'application/json',
      }).promise();

      results.ok.push(slug);
    } catch (err) {
      console.error(`Failed ${slug}:`, err.message);
      results.failed.push({ slug, error: err.message });
    }
  }

  return {
    ok: results.ok.length,
    failed: results.failed.length,
    details: results,
  };
};
