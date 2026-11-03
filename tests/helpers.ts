import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';

const fixtures = path.resolve(__dirname, 'fixtures');
const ref = path.resolve(__dirname, '..', 'reference');

const PNG = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  Buffer.alloc(600 * 1024),
]);

/** A real Toolkit icon (the "Search" line icon), recoloured white and sized 24px, to drop into the compliant page. */
function toolkitIcon(): string {
  const idx = JSON.parse(fs.readFileSync(path.join(ref, 'toolkit-index.json'), 'utf8')) as { icons: any[] };
  const f = idx.icons.find(i => i.title === 'Search' && i.line)!.line.file as string;
  const svg = fs.readFileSync(path.join(ref, f), 'utf8').replace(/<svg([^>]*?)width="\d+"([^>]*?)height="\d+"/, '<svg$1width="24"$2height="24"');
  return `<style>.tk path{fill:#FFFFFF !important}</style><span class="tk">${svg}</span>`;
}

const FAKE_EMBLEM = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40" viewBox="0 0 100 40"><circle cx="50" cy="20" r="18" fill="#cc0000"/></svg>';

const results = (q: string) =>
  `<!doctype html><html lang="en"><head><title>Search results</title></head><body><main><h1>Results for ${q}</h1>` +
  Array.from({ length: 5 }, (_, i) => `<p><a href="/r${i}">Result number ${i + 1} about ${q} and related information</a></p>`).join('') +
  `<p>You searched for ${q}. More about ${q} follows.</p></main></body></html>`;

/** The Toolkit emblem rendered as a small PNG, the way a site would normally ship it. */
const emblemPng = () => sharp(fs.readFileSync(path.join(ref, 'emblem.svg')), { density: 300 }).resize(116, 200, { fit: 'inside' }).png({ compressionLevel: 9 }).toBuffer();

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>
<header><nav><a href="/ms/">Home</a> <a href="/ms/about">About Us</a> <a href="/ms/team">Our Team</a> <a href="/ms/organisations">Our Organisations</a> <a href="/ms/vacancies">Vacancies</a> <a href="/ms/tenders">Tenders</a> <a href="/ms/documents">Documents</a> <a href="/ms/contact">Contact Us</a></nav></header>
<main>${body}</main><footer><p>Last Updated On: 01.01.2020</p></footer></body></html>`;
const table = (head: string[], rows: string[][]) => `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;

/** A tiny Ministry-style site with deliberately imperfect pages, for the review-pack tests. */
const MS: Record<string, string> = {
  '/ms/': page('Ministry of Test', `<h1>Ministry of Test</h1><blockquote>Prime Minister Narendra Modi: "Good governance means that every citizen is served with speed and dignity."</blockquote>
    <form action="/ms/x"><p>Apply for a service</p><label for="a">Name</label> <input id="a" name="a"> <label for="b">E-mail</label> <input id="b" name="b"> <label for="c">Message</label> <input id="c" name="c"> <button type="submit">Send</button></form>`),
  '/ms/about': page('About Us', `<h2>Objectives</h2><ul><li>Promote digital services</li><li>Improve citizen access</li><li>Support industry</li><li>Ensure security</li></ul>`),
  '/ms/team': page('Our Team', `<h2>Leadership</h2><p>Dr. Asha Rao, Minister</p><p>Mr. Vikram Sen, Secretary</p><p>Shri Mohan Das, Joint Secretary</p><p>Dr Kiran Patel, Director</p>`),
  '/ms/organisations': page('Our Organisations', `<h2>Attached offices</h2><ul><li>Central Data Office</li><li>National Services Board</li><li>Regional Training Institute</li></ul>`),
  '/ms/vacancies': page('Vacancies', table(['Post', 'Last date'], [['Analyst', '12-03-2020'], ['Officer', '30-06-2021'], ['Clerk', '01-01-2022']])),
  '/ms/tenders': page('Tenders', table(['Tender ID', 'Closing Date'], [['T-001', '15/05/2019'], ['T-' + 'X'.repeat(60), '20/09/2019']])),
  '/ms/documents': page('Documents', table(['Title', 'Date'], [['Annual report', '10 March 2024'], ['Circular on training', '02-02-2023'], ['Guidelines (no date)', '']])),
  '/ms/contact': page('Contact Us', `<h2>Officers</h2><p>Chief Information Officer: A. Kumar, cio@example.gov.in</p><p>Public Information Officer: B. Singh, +91 11 2345 6789</p><iframe src="https://www.google.com/maps/embed?pb=x" width="300" height="200"></iframe>`),
};

export async function startServer(): Promise<{ base: string; close: () => void }> {
  const emblem = await emblemPng();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (type: string, body: Buffer | string, status = 200) => { res.writeHead(status, { 'content-type': type }); res.end(body); };
    switch (url.pathname) {
      case '/big.png': return send('image/png', PNG);
      case '/NotoSans-Regular.ttf': return send('font/ttf', fs.readFileSync(path.join(fixtures, 'NotoSans-Regular.ttf')));
      case '/emblem.png': return send('image/png', emblem);
      case '/fake-emblem.svg': return send('image/svg+xml', FAKE_EMBLEM);
      case '/search': return send('text/html', results(url.searchParams.get('q') ?? ''));
      case '/missing.mp4': return send('text/plain', 'not found', 404);
      case '/ms/': case '/ms/about': case '/ms/team': case '/ms/organisations': case '/ms/vacancies': case '/ms/tenders': case '/ms/documents': case '/ms/contact': return send('text/html', MS[url.pathname]);
      case '/proof': return send('text/html', fs.readFileSync(path.join(fixtures, 'proof.html')));
      case '/topbar': return send('text/html', fs.readFileSync(path.join(fixtures, 'topbar.html')));
      case '/good': return send('text/html', fs.readFileSync(path.join(fixtures, 'good.html'), 'utf8').replace('<!--ICON-->', toolkitIcon()));
      default: return send('text/html', fs.readFileSync(path.join(fixtures, 'bad.html')));
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
}
