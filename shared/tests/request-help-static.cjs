const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '../..');
const pages = [
  ['community-user/frontend/community-user_report-problem.html', 'community-user_report-problem.js', 'community-user_report-problemForm'],
  ['community-user/frontend/community-user_request-service.html', 'community-user_request-service.js', 'community-user_request-serviceForm'],
  ['community-user/frontend/community-user_request-new-item.html', 'community-user_request-new-item.js', 'community-user_request-new-itemForm'],
];

for (const [page, script, formId] of pages) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const js = fs.readFileSync(path.join(root, 'community-user/frontend', script), 'utf8');
  assert.match(html, new RegExp(`id="${formId}"`));
  assert.match(html, new RegExp(`src="${script}"`));
  assert.match(html, /src="community-api\.js"/);
  assert.match(js, /CommunityAPI\.(createRequest|createReport)/);
}

const help = fs.readFileSync(path.join(root, 'community-user/frontend/community-user_request-help.html'), 'utf8');
assert.match(help, /community-user_report-problem\.html/);
assert.match(help, /community-user_request-service\.html/);
assert.match(help, /community-user_request-new-item\.html/);

const dashboard = fs.readFileSync(path.join(root, 'community-user/frontend/community-user_dashboard.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'community-user/frontend/community-user_dashboard.js'), 'utf8');
assert.match(dashboard, /id="donationSearchForm"/);
assert.match(dashboardJs, /CommunityAPI\.searchAvailableDonations/);
assert.match(dashboardJs, /community-user_request-new-item\.html\?item=/);

const api = fs.readFileSync(path.join(root, 'community-user/frontend/community-api.js'), 'utf8');
assert.match(api, /API\.createRequest/);
assert.match(api, /API\.createReport/);
assert.match(api, /API\.searchAvailableDonations/);

console.log('PASS: Request Help pages, scripts, dashboard item search, and CommunityAPI contracts are statically wired.');
